# Hercules DFS – Review Findings

Scope requested: **replication, consistency, API usage, client libraries (Node.js, Go, Python, Zig), chunk padding, cold storage via archiving, corruption tracking.**

Reviewed at commit `4c14ec3` (`main`). Line numbers refer to that commit.

**Evidence legend**

- **[R]** Reproduced by running code against a local cluster (in-process master + chunkservers, `miniredis` standing in for Redis). Repro programs were scratch tests and are not committed; see the appendix for how to recreate them.
- **[C]** Found by code inspection only (not executed).

**Severity legend**: **P0** = data loss / corruption / process-wide hang or the feature cannot work at all. **P1** = incorrect behaviour in normal use. **P2** = robustness, hygiene, docs.

---

## 0. Executive summary

| # | Area | Headline | Sev | Evidence |
|---|------|----------|-----|----------|
| 1 | API / consistency | `Write` at a non-zero chunk offset always writes at offset 0 (client discards the offset; server returns end-offset instead of bytes written, which hides it) | P0 | [R] |
| 2 | Replication | Default 3-chunkserver deployment cannot allocate a chunk: master asks for `MinimumReplicationFactor + 1 = 4` servers | P0 | [R] |
| 3 | Padding / replication | Append that crosses a chunk boundary can never succeed when the chunk has replicas (replicas reject the `Pad` mutation; exactly-full chunk fails on the primary too) | P0 | [R] |
| 4 | Cold storage | `archiveChunks()` never returns, which freezes the chunkserver's only background loop (heartbeat, GC, metadata persistence) | P0 | [R] |
| 5 | Cold storage | Archived chunks are unreadable (`ReadChunk` doesn't un-archive); archived empty chunks can never be restored (hang) | P0 | [R] |
| 6 | Consistency | Lock-order inversion between read and append deadlocks a chunk (and then the server) almost immediately under concurrent read+append | P0 | [R] |
| 7 | Corruption | No checksum is ever verified; reading a fully corrupted chunk returns the garbage with `err == nil` | P0 | [R] |
| 8 | API / client | `Read` into a buffer larger than the remaining data returns the right `n` but leaves the buffer zeroed | P0 | [R] |
| 9 | Replication | Chunk version protocol is incoherent: master never bumps, only the primary bumps, and the master's probe flags the primary as stale (stale replicas are then put on the GC list) | P0 | [R] |
| 10 | Replication | Master chunk-handle counter is rebuilt as `count(live handles)`, so handles are reused after delete + restart | P0 | [C] |
| 11 | Durability | Master persists metadata every **15 h**, non-atomically, with no WAL; a corrupt/empty metadata file leads to the master telling chunkservers to delete every chunk | P0 | [C] |
| 12 | Client libs | Only a Go SDK exists and it is bound to Go `net/rpc` + `gob`; there is no Node.js / Python / Zig client and no language-neutral wire protocol or OpenAPI spec | P1 | [C] |
| 13 | API | Gateway docs describe an API that does not exist (different routes, verbs, status codes, error shape) | P1 | [C] |

---

## 1. Replication

### 1.1 Chunk allocation needs 4 servers but the product advertises 3 — P0 [R]

- `master_server/master_server.go:720` calls `chooseServers(common.MinimumReplicationFactor + 1)`; `MinimumReplicationFactor = 3` (`common/constants.go:58`).
- With 3 chunkservers (README quick-start, "manual setup", and every doc says 3) `GetChunkHandle` fails with `no enough servers for 4 replicas`. Reproduced; every `Write`/`Append`/`GetChunkHandle` fails.
- Repo is inconsistent about the replica count: docs say "triple replication", allocation uses 4, under-replication threshold is `< 3`, docker-compose ships 5 servers.
- `chooseServers` (`cs_manager.go:420`) sorts by RTT then ignores the sort by taking `common.Sample` of random indexes. There is no capacity, rack/zone or load awareness.

### 1.2 Chunk version protocol is not coherent — P0 [R]

| Where | Behaviour |
|-------|-----------|
| Master (`chunkInfo.version`) | Never incremented anywhere. Stays `0` forever (the comment at `cs_manager.go:340` even says expiry must not bump it). |
| Primary (`performWrite`, `chunkserver.go:1436-1440`) | `if mutations[version] exists { version++ } else { mutations[version] = m }`: the version only moves on every *second* write, and only on the primary. Secondaries never bump (`ApplyMutation` doesn't touch it). |
| `RPCCheckChunkVersionHandler` (`:882`) | If the replica is exactly one version behind it **silently increments its own version** (`:908`) without receiving the missing data, i.e. it fakes catching up. |
| Master lease-expiry probe (`getLeaseHolder`, `cs_manager.go:340-385`) | Probes each replica with the master's version (`0`). Reproduced: after 3 writes the primary has `version=1`, the secondaries `0`; the probe returns `stale=true` for the primary and `false` for the rest. Stale replicas are returned to the caller, which then calls `addGarbage` on them (`master_server.go:679`), so the only replica that "advanced" is scheduled for deletion. |
| Heartbeat reconcile (`master_server.go:568-600`) | Sends the *reporting* server's version to the *primary* and lets the primary judge. If there is no primary and `locations` is non-empty it falls through and registers the (possibly stale) replica as valid. |

Net effect: staleness detection can neither detect real stale replicas nor avoid evicting good ones. The GFS rule (master bumps version when it grants a new lease; replicas that miss mutations keep the old version and are excluded) is not implemented.

### 1.3 Mutation ordering, atomicity and idempotency — P0/P1 [C]

- **No serial numbers.** The primary applies locally then fans out `ApplyMutation` to secondaries concurrently (`performWrite`, `:1443-1475`). Two overlapping writes can land in different orders on different replicas, so replicas diverge with no way to detect it (no per-replica checksum comparison either, see §6).
- **No rollback / no "inconsistent" marking.** If a secondary fails after the primary applied, the primary keeps the data, returns an error, and nothing records that this region is undefined. The master isn't told and doesn't re-replicate.
- **Retries make non-idempotent RPCs at-least-once.** `shared.UnicastToRPCServer` retries 3× on *any* error, including deterministic application errors (backoff 0.5 s, 1 s) and timeouts after the server already applied the op. `AppendChunk`/`ApplyMutation` have no dedup token, so a lost reply yields a duplicate append. In my padded-append repro every failing call was executed 3× on the server.
- **`ForwardData` chain is not a pipeline.** The client sends the payload to *every* server and each is told to forward to all the others (`hercules.go:586-600`), i.e. O(N²) traffic. `RPCForwardDataHandler` returns early when the buffer entry already exists (`chunkserver.go:1026-1029`), so a partially completed chain is never finished on retry. Forward errors are only "logged" by `log.Err(errors.New(errStr)).Stack()` (`hercules.go:605`), which never calls `.Msg()`/`.Send()` and therefore emits nothing.
- **`DownloadBuffer` entries expire after 10 s** (`DownloadBufferItemExpire`; refreshed only on `Get`), the same as the RPC `CallTimeout`, so slow or retried forwards can hit `DownloadBufferMiss`. The buffer has no size cap (memory DoS).

### 1.4 Leases — P1 [C]

- `getLeaseHolder` re-grants a fresh lease (`lease.Expire = now+120s`, `chk.expire = lease.Expire`) on **every** call, even when the existing lease is still valid, and pushes `GrantLease` to the primary in an un-awaited goroutine (`cs_manager.go:400-415`). Clients can reach the primary before it has the lease → `LeaseExpired`.
- `RPCGrantLeaseHandler` always appends to `cs.leases`, so the deque grows without bound (one entry per client request); expired entries are only removed when a write happens to select one.
- `RPCWriteChunkHandler` **pops** the lease off the deque for the duration of the write (`:1097-1110`), so a concurrent write to the same chunk sees no lease and returns `LeaseExpired`.
- `RPCAppendChunkHandler` doesn't check the lease at all; any server that receives an append call will act as primary.
- `extendLease` (`cs_manager.go:305`) mutates `chk.expire` with no lock and only rejects a non-primary when the lease hasn't expired, so after expiry anybody can "extend".
- `cs.leases` is read in `heartBeat()` (`:524`) and mutated in write/grant handlers under different (or no) locks → data race.
- Client caches the `*Lease` and then does `append(writeLease.Secondaries, writeLease.Primary)` and `writeLease.Primary = servers[0]` (`hercules.go:570-581`), mutating the cached lease/backing array concurrently.

### 1.5 Re-replication — P1 [C]

- `serverHeartBeat` returns early on **any** failed ping (`master_server.go:270-272`) *before* it looks at `replicationMigration()`. One flaky chunkserver stops re-replication cluster-wide.
- Replication runs inline in the 10 s health-check goroutine; 64 MB gob copies block failure detection.
- `chooseReplicationServer` always takes the first live location as the source (`cs_manager.go:550`) and the first live non-holder as the target. A corrupt/stale first replica poisons every retry (§6); no capacity check.
- Failure re-queues immediately (`queueReplication`) → 10 s retry loop with no backoff/limit.
- No over-replication cleanup (a returning server's data is simply re-registered), no rebalancing.
- `GetSnapshot`/`ApplyCopy` run while writes are in flight, so verify (`src` vs `dst` checksum/length) can fail forever on hot chunks. `ApplyCopy` doesn't truncate the target, so a longer stale target keeps trailing bytes.
- First heartbeat after (re)registration returns before the chunk report (`master_server.go:537-539`); a restarted master only learns locations on the second heartbeat.

### 1.6 Partial allocation and orphaned state — P1 [C]

- `RPCGetChunkHandleHandler` increments `file.Chunks` **before** checking the `createChunk` error (`master_server.go:727-731`). On a partial failure the handle is recorded, replicas that did succeed are orphans (`addChunk` skipped, no rollback), and the client gets an error but the file now has an extra chunk.
- `DeleteFile` is invoked by the gateway with `DeleteHandle=false` always (`gateway/server.go:333`), so chunk metadata and replica data are never garbage collected. `csm.files[path]` keeps the old handle list; re-creating the same path later makes `getChunkHandle(path, 0)` return the **old** handle (new handles are appended after the stale ones), so a "new" file can show old data. (Code-inspected, not executed.)
- `Rename` does namespace rename and then `UpdateFilePath`; if the second step fails the two are out of sync (no transaction).
- Namespace `MkDirAll` treats a path as a file only if it has an extension (`nsmanager.go:336`). `RPCGetChunkHandleHandler` calls it on the *file* path, so an extension-less file (`/data/blob`) is created as a directory and `Create` then no-ops.
- Heartbeat "namespace sync" (`master_server.go:607-665`) can re-create files that were deleted and inflates `file.Length` from any replica's chunk length (including padded length).

---

## 2. Consistency and concurrency

### 2.1 Writes always go to chunk offset 0 — P0 [R]

`WriteChunk` does `writeLease, nextOffset, err := ObtainLease(handle, offset)` then `offset = nextOffset` (`hercules.go:564-568`). `ObtainLease` **always** returns `0` as the offset (`:153-173`). So whatever offset the caller passes is replaced by 0.

Repro: `Write(p, 0, "AAAAAAAAAA")` then `Write(p, 10, "BBBBBBBBBB")` → `Read(p,0,10)` returns `BBBBBBBBBB`; master reports `Length:20`; all four replicas contain only `BBBBBBBBBB` on disk.

It is masked because `writeChunk` returns `int(newLen)` (end offset), not bytes written (`chunkserver.go:1615`): with offset forced to 0 the two are equal. Fixing the client alone would expose `Write` double-counting (`n = offset+len`).

### 2.2 Read/append lock-order inversion deadlock — P0 [R]

- `RPCReadChunkHandler`: `chInfo.RLock()` → `readChunk` → `cs.mu.Lock()` (`:950`, `:1634`).
- `writeChunk(lock=true)` (append/write): `cs.mu.Lock()` → `chInfo.Lock()` (`:1552-1563`).

Reproduced with 4 readers + 2 appenders on one chunk: 1 operation completes and everything stalls permanently. Because `cs.mu` is the server-wide mutex, the whole chunkserver goes with it.

Related lock problems:

- `unarchiveChunks` returns on `!ok` **without unlocking `cs.mu`** (`:370-373`). Reproduced: after calling it with an unknown handle `cs.mu` is held forever.
- `readChunk` takes the *exclusive* `cs.mu` for the duration of file I/O, serializing all reads and writes on the server.
- `persistMetadata` and `RPCSysReportHandler` hash whole 64 MB chunks (`checksumDirty`) while holding `cs.mu.Lock()`. The master triggers SysReport on every non-first heartbeat (every 5 s per server).
- `RPCAppendChunkHandler` reads/writes `chInfo.length` with no lock (`:1232-1241`) → two concurrent appends can choose the same offset.
- Append uses `Seek(0, SeekEnd)` and ignores the chosen `offset` (`:1581`), so primary and replicas can pick different offsets if any replica's file length differs.

### 2.3 Read path — P1 [R]/[C]

- **[R]** `HerculesClient.ReadChunk` returns on `ReadEOF` *before* `copy(data, reply.Data)` (`hercules.go:436-441`). Any read where the buffer is larger than the remaining data returns `n=5, err=io.EOF` and an all-zero buffer (reproduced with a 5-byte file and a 64-byte buffer). Existing tests only read exactly `len(data)` so they never hit this. The gateway's `read` endpoint uses this path.
- `Read` allows `index == reply.Chunks` (`hercules.go:329`, `:343`) and then calls `GetChunkHandle`, which **allocates a new chunk on 4 servers** when `index == file.Chunks`. Reading an empty file, or at an exact chunk boundary, mutates the cluster. [C]
- `RPCReadChunkHandler` allocates `make([]byte, args.Length)` from an unvalidated client value and returns the full-length slice (zero filled past `n`) (`:950`).
- Reads go to a random replica with no version/staleness check and `ReadChunkArgs.Lease` is ignored.
- `UpdateFileMetadata` (client-driven after write/append) unconditionally sets `Length`/`Chunks` (`nsmanager.go:551-554`). Concurrent appenders can make length go backwards; a wrong `Chunks` desynchronises `file.Chunks` from `csm.files[path].handles`, which then allocates duplicate chunks for an existing index. [C]

---

## 3. API usage

### 3.1 Errors: `ErrorCode` is lost when a handler also returns `error` — P1 [R]

Several handlers set `reply.ErrorCode` and then return a non-nil error (`DownloadBufferMiss` at `:1083`/`:1149`; replicated `AppendExceedChunkSize` via the joined errors at `:1282`). `net/rpc` does not send the reply when the method returns an error, so the code never reaches the client. The client branches on those codes (`hercules.go:501`, `:688`, `:625`) and therefore the "advance to next chunk" and "retry lease" paths are unreachable on the error path. Observed: the client got a plain `rpc call ... exceeds max size` string after 3 retries instead of `AppendExceedChunkSize`.

Pick one channel: either return `nil` + `ErrorCode`, or return a typed error encoded in the string with a parse helper on the client.

### 3.2 Other RPC-level issues — P2 [C]

- `common.Checksum` is a Go `string` holding **raw 32 SHA-256 bytes** (`common.Checksum(hasher.Sum(nil))`), not hex. It's not valid UTF-8; JSON/logs mangle it; docs show `"a1b2c3d4"` (32-bit). An unused hex helper (`ComputeChecksum`) exists.
- `MutationAppend=2`, `MutationWrite=4`, `MutationPad=6` (`(iota+1)<<1`, `constants.go:64-70`) are commented "flags" but `Pad == Append|Write`; don't use them as bit flags.
- Dead / placeholder fields on the wire: `ReadChunkArgs.Data`, `ReadChunkArgs.Lease`, `HeartBeatArgs.PendingLeases`, `GetPathInfoArgs.Handle`, `PersistedChunkInfo.StatusFlags` (never written).
- `SysReportInfoReply` ships each chunk's whole `Mutations` map **including payload bytes** to the master every heartbeat; the same map (with payloads) is gob-persisted into `chunk.server.meta`. `ChunkSize` in the persisted record is `len(mutations)/1024`.
- `UnicastToRPCServer` opens a new TCP connection per call (docs claim "connection pooling"), has no TLS/auth/version negotiation, and retries unconditionally (see §1.3).
- `PesistentMeta` typo; `rpc_struct` mixes public/internal types that the SDK leaks.

### 3.3 HTTP gateway — P1 [C]

- **Docs ≠ implementation.** `docs/api/gateway.md` and `README.md` document `/api/v1/files`, `/files/download`, `/files/upload` (multipart), `/directories`, `/chunks/:handle`, `/system/status`, `/system/metrics`, HTTP range, Prometheus `/metrics`, `201/404/409` codes and `{ "error": { "code", "message", "details" } }`. The code registers only: `GET /api/v1/chunk/handle`, `GET /api/v1/chunk/servers`, `POST /mkdir`, `POST /create`, `DELETE /delete`, `PATCH /rename`, `GET /list`, `GET /fileinfo`, `GET /read`, `POST /write`, `PATCH /append`, `GET /health`. Every failure is HTTP 500 with `{error, code, message}`; `/health` returns `time` not `timestamp`.
- **Unsafe verbs.** `GET /api/v1/chunk/handle` allocates files, directories and chunks (side-effecting GET; CORS preflight/prefetchers/crawlers can trigger it). `DELETE` takes a JSON body (many clients/proxies drop it) while docs say query string.
- **Silent defaults.** An unparsable `offset` becomes `0` on both `read` and `write` (`gateway/server.go:449`, `:489`), i.e. `?offset=abc` overwrites the file head. `length<=0` silently becomes 4096.
- **Unbounded bodies.** `io.ReadAll(c.Request.Body)` on write/append with no `MaxBytesReader`; reads allocate up to 64 MB per request with no concurrency limit.
- **No end-to-end integrity.** No `Content-MD5`/`ETag`/`X-Checksum` on read or write; no Range/EOF signalling.
- **No security.** `AllowOrigins: *` combined with unauthenticated DELETE/PATCH/POST means any web page can delete/overwrite data on a reachable gateway. Redis is published on host `:6379` without auth in docker-compose; containers override `USER` with `user: "0:0"`.
- `g.mu` is used inconsistently (`Lock` in create, `RLock` elsewhere, held across RPCs) and protects nothing.
- Gateway always sets `DeleteHandle=false` (storage leak, see §1.6) and has no archive/restore/scrub/checksum endpoints.

### 3.4 Go SDK ergonomics — P2 [C]

- README snippets don't compile: `NewHerculesClient(addr)` vs real `(ctx, addr, cleanup)`; `Write` returns `(int, error)`; `Read(path, offset, buf)` not `(path, 0, len)`.
- `Write`/`Read`/`Append` fail unless the file was `CreateFile`d first (doc examples imply implicit create).
- No `context.Context` on operations (cannot cancel), `Close()` doesn't close connections, no pooling, errors from the RPC layer are plain strings so `err.(common.Error)` type assertions only work for locally-constructed errors.
- `go.mod` needs Go 1.24 (`toolchain go1.24.3`, uses `for range n`, `min`), README badge/prerequisites say Go 1.18+. Dockerfile builds on `golang:tip-alpine3.22` (unpinned).

---

## 4. Client libraries (Node.js, Go, Python, Zig)

Current state:

| Language | Status | Notes |
|----------|--------|-------|
| Go | `hercules` package (SDK) | Works only with the Go server: wire protocol is Go `net/rpc` + `encoding/gob`. Import path is `github.com/caleberi/distributed-system/hercules` (module name unrelated to product). Known data-path bugs in §2.1/§2.3/§3.1. |
| Node.js | **none** | Only option is the HTTP gateway. |
| Python | **none** | `dtest.py`/`dlog.py` are a Go-test runner and log viewer (6.824-style), not a client. `dtest.py` imports `typer`, which isn't in `requirements.txt` (it lists `plac`, which isn't used), so the documented `python dtest.py` fails on a clean install. |
| Zig | **none** | `net/rpc` + `gob` are not implementable in practice; HTTP is the only route. |

Problems that affect every non-Go client:

1. **No language-neutral protocol.** Control plane and data plane (chunkserver `ForwardData/Write/Append/Read`) are Go-only. The gateway is a single hop that re-implements the client logic, so every non-Go read/write is proxied through it and buffered in memory.
2. **No machine-readable contract.** No OpenAPI/JSON-Schema/proto; docs are wrong (§3.3). Clients can't be generated or contract-tested.
3. **Error model is unusable across languages**: everything is 500, `code` is a stringified Go int (`fmt.Sprint(cerr.Code)`), semantic codes (`LeaseExpired`, `AppendExceedChunkSize`, not-found, exists) can't be distinguished.
4. **Integer widths.** Offsets/lengths/handles are `int64` in JSON. Node.js `number` is exact only up to 2^53; use `BigInt`/string for `offset`, `length`, `handle`. Zig is fine with `i64`; Python is fine.
5. **Binary/checksum encoding.** Checksums are raw bytes in a string; clients cannot compare or verify them (need hex/base64 + algorithm id).
6. **Streaming.** No chunked upload/download, no resumable operations, no Range; large objects must fit in gateway memory (64 MB read cap, unbounded write).
7. **Semantics clients must know but the API doesn't expose**: append offset/duplicates semantics ("at-least-once at an offset chosen by the system"), padding regions (§5), file must be pre-created, concurrent writer undefined regions.
8. **Auth/TLS** are not implemented, so any SDK has to ship without credentials support.

Recommendations (in order): (a) publish an OpenAPI 3 spec generated from the gateway and fix the docs; (b) return correct HTTP status codes and a stable error `code` enum string; (c) make read/write/append streaming and add checksum headers; (d) generate Node/Python/Zig clients from the spec (thin wrappers for retries/idempotency keys); (e) if direct-to-chunkserver access is wanted, define the data-plane in protobuf/gRPC (or a framed binary protocol with explicit checksums) instead of gob.

---

## 5. Chunk padding

Intended behaviour (GFS and `docs/api/chunk-server.md:152`): if an append doesn't fit, the primary pads the rest of the chunk on all replicas and tells the client to retry on the next chunk.

What the code does (`RPCAppendChunkHandler`, `:1235-1248`; `doMutate`, `:1514-1516`; `writeChunk`):

1. **Padding writes one byte, not the remainder.** For `MutationPad`, `doMutate` replaces the payload with `[]byte{0}` and writes it at `offset` (`:1515`). The chunk file becomes `offset+1` bytes (sparse) while the logical chunk length is claimed to be 64 MB. P0 [C]
2. **Replicas reject the pad.** `RPCApplyMutationHandler` computes `offset + len(originalData)` *before* looking at the mutation type and fails when > 64 MB (`:1155-1161`), which is always true for a pad. Reproduced with 4 replicas and 15 MiB appends: the primary pads, all three secondaries return `provided data size for append action ... is larger than the max allowed data size`, and the append fails after three retries. P0 [R]
3. **Exactly-full chunk also fails on the primary.** If the chunk is already 64 MiB, pad offset = 64 MiB and `newLen = 64 MiB + 1 > ChunkMaxSizeInByte` in `writeChunk` (`:1559`) → error (reproduced with 16 MiB × 4 then another append). P0 [R]
4. **`AppendExceedChunkSize` never reaches the client** because the handler returns an error alongside it (§3.1), so `Append` never moves to the next chunk; after the failure the retry sees the primary's mutated `length`.
5. **Divergent state across replicas.** The primary sets `chInfo.length = ChunkMaxSizeInByte` before the write (`:1240`, no lock); secondaries compute `length = offset+1`. `completed` is only set when `newLen >= Max`, so a padded chunk is never sealed. [C]
6. **Padded region breaks other paths.** `GetSnapshot` reads `make([]byte, chInfo.length)` with `ReadAt`, which returns `io.EOF` on the short file, so re-replicating a padded chunk fails (`:1317-1320`). Reads of the padded range return EOF rather than zeros. Master heartbeat-sync takes the chunk's reported length (64 MB) as file length, so file `Length` includes padding. [C]
7. **No self-validating record framing.** GFS relies on readers skipping padding and duplicates via record headers/checksums. Nothing here lets a reader identify padding or duplicates, and the gateway/API don't expose the information.
8. Padding wastes up to `AppendMaxSizeInByte` (16 MiB, 25 %) per chunk — same trade-off as GFS but should be configurable and documented.

Suggested fix outline: handle `MutationPad` before size checks; pad = write zeros (or `Truncate`) up to `ChunkMaxSizeInByte` on every replica; set `length`/`completed` consistently on all replicas under the chunk lock; return `AppendExceedChunkSize` as a non-error reply; add a record-framing option or at least return pad/duplicate markers.

---

## 6. Corruption tracking

Claimed (docs `architecture/overview.md:198-203`, `api/chunk-server.md:283-287`, `architecture/components.md:122-125,179`): 64 KB blocks with 32-bit checksums, verified on reads, idle scanning, mismatch reported to master which triggers re-replication.

Implemented:

1. **Nothing verifies on read — P0 [R].** `RPCReadChunkHandler` never touches the checksum. Reproduced: corrupt the on-disk file on all four replicas → `Read` returns the garbage with `err == nil`, and the post-corruption `SysReport` still shows the *old* checksum on all replicas (so the data to detect it existed, nobody looked).
2. **Checksum granularity/semantics.** One SHA-256 for the whole 64 MB chunk, recomputed lazily from **whatever is on disk** (`checksumDirty`, in `persistMetadata`/`SysReport`, `:600-612`, `:823-835`). It is not computed from the data as received, so it can bless corruption that happened between write and the next recompute. Any read of a 1 KB range would require hashing 64 MB; GFS-style per-block checksums are the right design.
3. **No end-to-end integrity.** `ForwardDataArgs` and the HTTP API carry no checksum; a bit flip in transit or in the download buffer is committed on all replicas.
4. **Master doesn't compare replicas — P1 [C].** `RPCHeartBeatHandler` overwrites `chk.checksum` with whichever replica reported last (`master_server.go:564`). No cross-replica comparison at same version, no "suspect" state, no repair. `performReplication` only compares source vs the newly copied target, and the source checksum is the (possibly corrupt) on-disk hash; it always uses the same first source.
5. **No corruption signalling or repair.** There is no "report corrupt chunk" RPC, no scrubber/idle scan, no quarantine (`StatusFlags` exists but is never set), no counters/metrics, no API to list suspect chunks.
6. **Checksum state isn't persisted correctly — P1 [C].** `checksumDirty` isn't persisted or restored; if recompute fails (open/read error, or chunk compressed) the stale checksum is persisted and after restart treated as clean. `isCompressed` isn't persisted either (§7).
7. **Metadata file corruption handling loses state silently — P1 [C].** On a gob decode error `loadMetadata` renames the file to `*.corrupt.<ts>` and starts with an empty chunk table (`:470-483`), with no rebuild-from-disk scan. Same on the master (`master_server.go:424-436`), where an empty chunk table results in `reply.Garbage` for every chunk a server reports (`:556-560`), i.e. the cluster is told to delete all data. `persistMetadata` truncates in place (no temp file + fsync + rename), so a crash mid-write produces exactly this corrupt file.
8. **Compression integrity isn't checked against the chunk checksum.** gzip CRC protects the stream, but neither compress nor decompress compares the result to the stored chunk SHA-256.

Suggested fix outline: per-64 KB block CRC32C (or xxhash) stored in a sidecar and updated on every write (computed from the received buffer); verify on every read; on mismatch return a distinct error, mark chunk suspect, report to master via heartbeat; master removes that replica from locations, schedules re-replication from a *verified* replica, and records the event; add a background scrubber; persist metadata atomically (tmp + fsync + rename, with a checksum footer).

---

## 7. Cold storage via archiving

What exists: `archive.ArchiverManager` gzips `chunk-N.chk` to `chunk-N.chk.gz` **in place on the same disk** and removes the original. Docs (`components.md:334-360`, `README`) promise snapshots, a separate archive store and restore. None of that exists.

### 7.1 `archiveChunks()` never returns — P0 [R]

`archiveChunks` starts a goroutine that does `for result := range cs.archiver.CompressPipeline.Result` (`chunkserver.go:334`). That channel is only closed in `ArchiverManager.Close()`, so `wg.Wait()` blocks forever — even when there is nothing to archive. The call happens from the **single** background `select` loop that also does heartbeat, GC and metadata persistence (`:236-285`). Reproduced: `archiveChunks` still running after 8 s. After the first archive tick (5 days) the server never sends another heartbeat, never GCs, never persists metadata. The master still sees it as live because it pings the RPC port itself (`markServerLive`).

### 7.2 Policy bugs — P1

- New chunks have **zero `accessTime`** (`RPCCreateChunkHandler` doesn't set it) so `time.Since(zero)` is huge: a chunk created seconds ago is eligible at the first tick (reproduced). [R]
- Only reads update `accessTime`; writes/appends don't (`writeChunk` updates `lastModified` only), so hot written chunks are "cold". `completed`/`lastModified` aren't considered. [C]
- `ArchiveChunkInterval = 5 days` ticker restarts with the process; any server restarted more often than every 5 days never archives. `ArchivalDaySpan` is hard-coded, not configurable. [C]
- Threshold and tick interval are both 5 days, so a chunk is archived 5–10 days after its last read. [C]

### 7.3 Data-loss and consistency hazards — P0 [C]

- Compression is **not synchronised with writers**: `archiveChunks` holds no chunk lock while the worker reads the file and then removes the original (`archiver_manager.go:226-290`). A write/append during compression is lost (copy-then-delete) or recreates a fresh partial `chunk-N.chk` (writer opens with `O_CREATE`) next to the `.gz` while `isCompressed` is true.
- Output is written directly to the final `.gz` name (`O_TRUNC`), no `fsync` of file or directory, then the source is removed; a crash leaves a partial `.gz` and possibly no source.
- `isCompressed` is **not persisted** (`PersistedMetaData` has no field). After restart the server thinks `chunk-N.chk` is plain; the next write recreates an empty `chunk-N.chk` (`O_CREATE`) next to the `.gz`, shadowing the archived data.
- `unarchiveChunks` returns while holding `cs.mu` if the handle is unknown (§2.2).
- `Close()` closes `Result` channels after a 10 s timeout even if workers are still running (`:323-326`) and closes `Task` channels while `Submit*` may be sending (check-then-send isn't atomic) → send-on-closed-channel panics. [C]

### 7.4 Restore path is broken — P0 [R]

- `RPCReadChunkHandler` doesn't call `unarchiveChunks`; write/append/snapshot/copy do. Reproduced: after archiving, `ReadChunk` fails with `stat .../chunk-7.chk: no such file or directory`. Read access is exactly what should trigger restore.
- `decompress` rejects an empty output (`archiver_manager.go:209-212`) while `compress` accepts an empty chunk, so an archived zero-length chunk can never be restored.
- Any decompress **error** returns `ResultInfo{Path: ""}` (`archiver_manager.go:125-129`, `:148-151`). `unarchiveChunks` waits for a result whose `Path == expectedOut` (`:405-412`), so the error result never matches and the caller blocks forever on an unbounded channel read (reproduced for the empty-chunk case: still blocked after 8 s); results for other chunks pile into `decompressPending` under the same loop. No timeout/context.
- `RPCGetSnapshotHandler` (re-replication) un-archives the whole chunk first, so replicating or repairing cold data silently warms it.

### 7.5 Not actually "cold storage" — P1/P2 [C]

- Same disk, same host; no tiering to object storage or a separate archive path, no capacity trigger, no restore-on-demand API, no master-side notion of archived state (master/gateway/SDK cannot see it), no metrics, no per-file/namespace policy, no rate limiting.
- Docs' "Snapshots", "Restore files from archives", "Store in separate archive storage" are not implemented. `docs/guides/development.md` calls the package `archive_manager/`; actual dir is `archive/`.
- Tests leave `archive/source.txt` behind in the working tree.

---

## 8. Durability of metadata (cross-cutting) — P0/P1 [C]

- Master persists **every 15 hours** (`MasterPersistMetaInterval`) plus on clean shutdown; no operation log. A crash loses up to 15 h of namespace and chunk mappings (README says "persistent metadata").
- Both master and chunkserver truncate and rewrite the live metadata file (no temp+rename, no fsync).
- Master handle counter after restart: `numberOfCreatedChunkHandle += len(fileInfo.handles)` per file (`cs_manager.go:660`) = number of *live* handles, not `max+1`. After deleting some files and restarting, new handles collide with live ones (overwriting `csm.chunks[handle]`), and with replicas awaiting GC on chunkservers; `RPCCreateChunkHandler` ignores an existing chunk (`:989-991`) so a new file may inherit old data. [C]
- `MasterServer.isDead` is never set, so `Shutdown` isn't idempotent (second call closes `shutdownChan` twice → panic). `NewMasterServer` returns `nil` on several errors but `log.Fatal`s on others.
- Single master with no shadow/replication, despite the comment "replicated to another backup server".

---

## 9. Smaller issues worth fixing while in here (P2) [C]

- `calculateRoundTripProximity` extracts the host with `TrimSuffix(addr, port)`, which leaves a trailing colon (`127.0.0.1:`), so `ping` always fails and the "0 ms" fallback is used. If ping ever succeeds, `extractAverageRTT`'s `avg = N ms` regex doesn't match Linux/BusyBox/macOS output, so start-up would fail. An address with no `:` panics (`SplitN(...)[1]`). Startup also blocks 15 s on 15 pings.
- `DownloadBuffer.Done()` wraps its body in `sync.OnceFunc` but never calls the returned func, so the cleanup goroutine never stops.
- `shutdownChan := make(chan os.Signal)` is unbuffered and registered with `signal.Notify` (signals can be dropped), and `Shutdown()` later `close`s it (a late signal would panic).
- `filesystem.restrictToRoot` calls `filepath.Rel` but never checks the result for `..`, so symlink escapes aren't detected.
- Integration tests (`chunkserver`, `gateway`, `hercules`) require Redis on `localhost:6379` and fail hard without it, although `miniredis` is already a dependency; `go test ./...` fails on a clean machine (the `chunkserver`, `gateway` and `hercules` packages).
- `ValidateFilename(filename, path)` ignores `path`; `README` says Docker Go badge 1.18; `docker-compose` mounts `chunkN-data:/data/chunks` but sets `ROOT_DIR: ./data/chunks` (works only because `WORKDIR /`).

---

## 10. Suggested order of work

1. **Data-path correctness**: client write offset (2.1) + `writeChunk` return value; `ReadChunk` copy-before-EOF (2.3); lock order / `unarchiveChunks` unlock (2.2); `ErrorCode` vs `error` convention (3.1); replicas size-check/pad (§5).
2. **Replica count + version protocol**: one replication-factor constant (≥3 servers must work); master-owned version bumped on lease grant; secondaries apply in order; `CheckChunkVersion` must not self-bump (1.1, 1.2).
3. **Archive**: fix the hang, persist `isCompressed`, restore on read with context/timeouts, lock out writers, init/update `accessTime`, make it configurable (§7).
4. **Corruption**: per-block checksums verified on read + scrubber + report/repair loop; atomic metadata writes (§6, §8).
5. **Master durability**: op-log + periodic checkpoint, handle counter = max+1, never treat an empty chunk table as "delete everything" (§8).
6. **API and clients**: OpenAPI + status codes + checksum headers + streaming; generate Node/Python/Zig clients; fix docs (§3.3, §4).
7. Add the missing tests: non-zero-offset write, short-buffer read, multi-chunk append/pad with ≥3 replicas, archive→read round trip + restart, corrupt-replica read/repair, concurrent read+append (with `-race`), master restart with deleted files.

---

## Appendix: how the [R] items were reproduced

- Start `miniredis` on `127.0.0.1:6379` (the server code hard-wires the Redis address in tests), then build clusters with `master_server.NewMasterServer` and `chunkserver.NewChunkServer` on free ports (4 chunkservers; 3 for finding 1.1), wait ~2 s for registration, then use `hercules.NewHerculesClient`.
- 2.1: `CreateFile`, `Write(0,"A"*10)`, `Write(10,"B"*10)`, read back + inspect `chunk-0.chk` on each replica.
- 2.3: write 5 bytes, `Read` into a 64-byte buffer.
- §5: 15 MiB appends ×5 (4 replicas), and 16 MiB ×5 for the exactly-full case.
- 1.2/§6: three overlapping writes, `RPCSysReportHandler` on each chunkserver (versions/checksums), `RPCCheckChunkVersionHandler` with `Version: 0`; overwrite every replica's `chunk-0.chk` and read.
- §7/2.2 (chunkserver package, white-box): `RPCCreateChunkHandler` then `archiveChunks()` / `unarchiveChunks()` with timeouts; `unarchiveChunks(<missing>)` then try `cs.mu.Lock()`; concurrent `RPCReadChunkHandler` ×4 and `RPCAppendChunkHandler` ×2 on one chunk.
