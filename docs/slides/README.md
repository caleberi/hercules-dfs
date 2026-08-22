# Hercules Architecture Slides

Interactive academic slide publication covering how Hercules works end-to-end:

1. Process startup and TCP listeners  
2. RPC connection model (`net/rpc` over TCP)  
3. Lazy chunkserver registration via heartbeats  
4. Master delegation (reads, leases, writes)  
5. Mutation protocol (push then commit)  
6. Dual heartbeat model  
7. Hard failure detection (60s timeout)  
8. Soft failure detection (φ Accrual)  
9. Re-replication and integrity checks  

## Open locally

Open the HTML file in a browser (no build step):

```bash
# from repo root
xdg-open docs/slides/hercules-architecture.html
# or
open docs/slides/hercules-architecture.html
```

Or serve it:

```bash
python3 -m http.server 8000 --directory docs/slides
# then visit http://localhost:8000/hercules-architecture.html
```

## Controls

| Input | Action |
|-------|--------|
| `→` / `Space` | Next slide |
| `←` | Previous slide |
| `T` | Outline |
| `Home` / `End` | First / last |
| On-slide buttons | Animate protocols, explore components, try φ demo |

## Source alignment

Thresholds and flows match:

- `common/constants.go`
- `shared/rpc.go`
- `master_server/`, `chunkserver/`, `detector/`
- `docs/architecture/overview.md` and `components.md`
