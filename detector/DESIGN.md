# Failure Detector Design Documentation

## Overview

The Failure Detector is a sophisticated distributed system component that implements the **ϕ (Phi) Accrual Failure Detection Algorithm**, originally proposed by Hayashibara et al. (2004). Unlike traditional binary failure detectors that classify nodes as simply "up" or "down", the ϕ Accrual approach provides a continuous suspicion level, allowing applications to make fine-grained decisions about node health based on probabilistic analysis of network behavior.

This implementation uses Redis as a persistent backing store for historical network latency samples, enabling distributed failure detection with crash recovery capabilities.

## Architecture

### Design Patterns

#### 1. Accrual Failure Detection Pattern

The core algorithm analyzes the statistical distribution of heartbeat inter-arrival times:

```
┌─────────────────────────────────────────────────┐
│         ϕ Accrual Failure Detector              │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │   Historical Sample Collection           │  │
│  │   (Network Latencies / Heartbeats)       │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│  ┌────────────────▼─────────────────────────┐  │
│  │   Statistical Analysis                   │  │
│  │   • Mean (μ): Average inter-arrival     │  │
│  │   • StdDev (σ): Variance measure        │  │
│  │   • Time since last heartbeat (Δt)      │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│  ┌────────────────▼─────────────────────────┐  │
│  │   ϕ Calculation                          │  │
│  │   ϕ = -log₁₀(1 - F(z))                  │  │
│  │   where z = (Δt - μ) / σ                │  │
│  │   F(z) = Normal CDF                      │  │
│  └────────────────┬─────────────────────────┘  │
│                   │                             │
│  ┌────────────────▼─────────────────────────┐  │
│  │   Threshold Interpretation               │  │
│  │   • ϕ < 1.0:  Healthy (Low Suspicion)   │  │
│  │   • 1.0 ≤ ϕ < 8.0: Warning (Moderate)   │  │
│  │   • ϕ ≥ 8.0:  Alert (High Suspicion)    │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Mathematical Foundation:**

The ϕ value is derived from the cumulative distribution function (CDF) of the normal distribution:

$$\phi = -\log_{10}(1 - F(z))$$

where:
- $z = \frac{\Delta t - \mu}{\sigma}$ (standardized time difference)
- $F(z) = \frac{1}{2}\left(1 + \text{erf}\left(\frac{z}{\sqrt{2}}\right)\right)$ (normal CDF)
- $\mu$ = mean inter-arrival time
- $\sigma$ = standard deviation of inter-arrival times
- $\Delta t$ = time since last heartbeat

**Benefits:**
- Continuous suspicion values enable graduated responses
- Adapts to changing network conditions automatically
- Probabilistically sound failure detection
- No fixed timeout thresholds

#### 2. Redis-Backed Sliding Window Pattern

```
┌────────────────────────────────────────────┐
│         Redis Storage Schema               │
├────────────────────────────────────────────┤
│                                            │
│  {serverIP}:main_set [SORTED SET]         │
│    ├─ member: entry_id_1                  │
│    │  score: timestamp_1                  │
│    ├─ member: entry_id_2                  │
│    │  score: timestamp_2                  │
│    └─ ...                                 │
│                                            │
│  {serverIP}:expired_set [SORTED SET]      │
│    ├─ member: entry_id_1                  │
│    │  score: expiry_timestamp_1           │
│    └─ ...                                 │
│                                            │
│  {serverIP}:item:{entry_id} [STRING]      │
│    └─ value: JSON(Entry)                  │
│                                            │
└────────────────────────────────────────────┘
```

**Design Rationale:**

| Component | Type | Purpose |
|-----------|------|---------|
| `main_set` | Sorted Set (by timestamp) | Chronological ordering of samples |
| `expired_set` | Sorted Set (by expiry time) | Efficient TTL-based cleanup |
| `item:*` | String (JSON) | Full sample data storage |

**Benefits:**
- O(log N) insertions and lookups
- Efficient range queries for windowing
- Automatic ordering by time
- Persistent across detector restarts
- Distributed access from multiple detector instances

#### 3. Thread-Safe State Management Pattern

```
┌─────────────────────────────────────────┐
│     FailureDetector State               │
├─────────────────────────────────────────┤
│                                         │
│  RWMutex (mu)                          │
│    ├─ Read Lock: Check shutdown state  │
│    └─ Write Lock: Set shutdown state   │
│                                         │
│  sync.Once (shutdownOnce)              │
│    └─ Ensures single shutdown          │
│                                         │
│  isShutdown (bool)                     │
│    └─ Protected by mu                  │
│                                         │
└─────────────────────────────────────────┘
```

**Concurrency Control:**

```
RecordSample():          PredictFailure():        Shutdown():
     │                        │                        │
     ├─ RLock ───────────────┤                        │
     │  Check shutdown        │                        │
     ├─ RUnlock ──────────────┤                        │
     │                        │                   ┌────▼────┐
     │                        │                   │  Once   │
     │                        │                   │  Lock   │
     │                        │                   │  Set    │
     │                        │                   └─────────┘
```

**Benefits:**
- Multiple concurrent reads (RecordSample, PredictFailure)
- Exclusive shutdown access
- No race conditions
- Idempotent shutdown operation

## Component Design

### Core Types

#### Entry
Represents a single network measurement:

```go
type Entry struct {
    Id       string        // UUID for unique identification
    Eta      time.Time     // Estimated time of arrival (sample timestamp)
    Duration time.Duration // Round-trip latency measurement
}
```

**Design Decisions:**
- **UUID ID:** Ensures global uniqueness across distributed deployments
- **Eta naming:** "Estimated Time of Arrival" reflects heartbeat arrival semantics
- **Duration type:** Type-safe latency representation

#### NetworkData
Captures bidirectional network trip measurements:

```go
type NetworkData struct {
    RoundTrip    time.Duration // Computed total
    ForwardTrip  TripInfo      // Client → Server
    BackwardTrip TripInfo      // Server → Client
}

type TripInfo struct {
    SentAt     time.Time
    ReceivedAt time.Time
}
```

**Validation Logic:**
```go
func (tf TripInfo) Valid() bool {
    return !tf.SentAt.IsZero() && 
           !tf.ReceivedAt.IsZero() && 
           tf.SentAt.Before(tf.ReceivedAt)
}
```

**Clock Skew Considerations:**
- Assumes deployments in same region
- Validates time ordering to detect clock issues
- Rejects backward time (ReceivedAt < SentAt)
- NTP synchronization recommended

#### SuspicionLevel
Configurable threshold values:

```go
type SuspicionLevel struct {
    AccumulationThreshold float64 // Alert level (e.g., 8.0)
    UpperBoundThreshold   float64 // Warning level (e.g., 1.0)
}
```

**Threshold Interpretation:**

| ϕ Range | Level | Meaning | Recommended Action |
|---------|-------|---------|-------------------|
| ϕ < 1.0 | Healthy | ~90% confidence node is up | No action |
| 1.0 ≤ ϕ < 8.0 | Warning | Moderate suspicion | Increase monitoring |
| ϕ ≥ 8.0 | Alert | ~99.99999% confidence of failure | Initiate failover |

**Tuning Guidelines:**
- **Conservative (AccumulationThreshold = 12):** Fewer false positives, slower detection
- **Aggressive (AccumulationThreshold = 5):** Faster detection, more false positives
- **Default (AccumulationThreshold = 8):** Balanced for most use cases

#### FailureDetector
Main detector implementation:

```go
type FailureDetector struct {
    ShutdownCh     chan bool                 // Shutdown signal
    SuspicionLevel SuspicionLevel           // Threshold config
    Window         *SamplingWindow[Entry]   // Sample storage
    ContextTimeout time.Duration            // Redis operation timeout
    shutdownOnce   sync.Once                // Shutdown guard
    mu             sync.RWMutex             // State protection
    isShutdown     bool                     // Shutdown flag
}
```

**Field Purposes:**

| Field | Type | Purpose |
|-------|------|---------|
| `Window` | `*SamplingWindow[Entry]` | Historical sample storage |
| `SuspicionLevel` | `SuspicionLevel` | Threshold configuration |
| `ContextTimeout` | `time.Duration` | Redis operation timeout (default: 30s) |
| `shutdownOnce` | `sync.Once` | Ensures single shutdown execution |
| `mu` | `sync.RWMutex` | Protects `isShutdown` flag |
| `isShutdown` | `bool` | Tracks shutdown state |

## Operational Semantics

### Sample Recording Flow

```
Client Application
    │
    ├─ Measure Network Latency
    │    ├─ Send request at T1
    │    ├─ Receive response at T2
    │    └─ Calculate: NetworkData{
    │         ForwardTrip: {T1, T1+50ms}
    │         BackwardTrip: {T1+50ms, T2}
    │       }
    │
    ├─ RecordSample(networkData)
    │    │
    │    ├─ Validate timestamps
    │    ├─ Calculate round-trip time
    │    ├─ Create Entry with UUID
    │    └─ Store in Redis via Window.Add()
    │         │
    │         ├─ Clean expired entries
    │         ├─ Marshal Entry to JSON
    │         ├─ Pipeline operations:
    │         │    ├─ SET item:{id} → JSON
    │         │    ├─ ZADD main_set → (timestamp, id)
    │         │    └─ ZADD expired_set → (expiry, id)
    │         └─ Enforce window size limit
    │
    └─ Sample stored ✓
```

### Failure Prediction Flow

```
Application
    │
    ├─ PredictFailure()
    │    │
    │    ├─ Check shutdown state
    │    │
    │    ├─ Fetch historical samples from Window
    │    │    └─ Redis: ZREVRANGE main_set 0 -1
    │    │    └─ Redis: MGET item:{id1} item:{id2} ...
    │    │
    │    ├─ Validate sample count
    │    │    └─ Require ≥ 50% of window size
    │    │
    │    ├─ Sort samples chronologically
    │    │
    │    ├─ Calculate inter-arrival intervals
    │    │    intervals[i] = timestamp[i+1] - timestamp[i]
    │    │
    │    ├─ Compute statistics
    │    │    μ = mean(intervals)
    │    │    σ = stddev(intervals)
    │    │
    │    ├─ Calculate time since last heartbeat
    │    │    Δt = now - last_timestamp
    │    │
    │    ├─ Compute ϕ value
    │    │    z = (Δt - μ) / σ
    │    │    F(z) = normal_cdf(z)
    │    │    ϕ = -log₁₀(1 - F(z))
    │    │
    │    ├─ Interpret against thresholds
    │    │    if ϕ ≥ 8.0 → ALERT
    │    │    elif ϕ ≥ 1.0 → WARNING
    │    │    else → HEALTHY
    │    │
    │    └─ Return Prediction{Phi: ϕ, Message: action}
    │
    └─ Prediction available for decision-making
```

### Window Cleanup Strategy

The `SamplingWindow` employs a two-phase cleanup strategy:

#### Phase 1: TTL-Based Cleanup
```
Cleanup Trigger: Before Add() or Get()
    │
    ├─ Query expired_set for entries with expiry < now
    │    Redis: ZRANGEBYSCORE expired_set -inf {now}
    │
    ├─ Pipeline removal:
    │    ├─ ZREM main_set {expired_ids}
    │    ├─ ZREM expired_set {expired_ids}
    │    └─ DEL item:{expired_ids}
    │
    └─ TTL expired entries removed
```

#### Phase 2: Size-Based Cleanup
```
If window size > configured limit:
    │
    ├─ Calculate excess: num_to_remove = current_size - max_size
    │
    ├─ Query oldest entries
    │    Redis: ZRANGE main_set 0 {num_to_remove-1}
    │
    ├─ Pipeline removal:
    │    ├─ ZREM main_set {oldest_ids}
    │    ├─ ZREM expired_set {oldest_ids}
    │    └─ DEL item:{oldest_ids}
    │
    └─ Size limit enforced
```

**Efficiency Characteristics:**
- Cleanup time complexity: O(k log n) where k = items removed, n = window size
- Pipeline batching reduces network round-trips
- Cleanup overhead amortized across operations

## Statistical Analysis Deep Dive

### Normal Distribution Assumption

The algorithm assumes heartbeat inter-arrival times follow a **normal distribution**:

$$T \sim \mathcal{N}(\mu, \sigma^2)$$

**Justification:**
- Central Limit Theorem: Network latencies are sums of many independent factors
- Empirical validation in original paper (Hayashibara et al., 2004)
- Works well for stable networks with Gaussian jitter

**When Assumption Breaks:**
- Bimodal network paths (failover scenarios)
- Heavy-tailed distributions (network congestion)
- Consider using robust statistics (median, MAD) instead

### Phi (ϕ) Value Interpretation

The ϕ value represents **negative log-probability of node being alive**:

$$\phi = -\log_{10}\left(1 - P(\text{node alive})\right)$$

**Concrete Examples:**

| ϕ Value | P(alive) | P(failed) | Interpretation |
|---------|----------|-----------|----------------|
| 0.0 | 100% | 0% | Just received heartbeat |
| 1.0 | 90% | 10% | Minor delay, likely healthy |
| 2.0 | 99% | 1% | Noticeable delay |
| 3.0 | 99.9% | 0.1% | Significant delay |
| 5.0 | 99.999% | 0.001% | Very suspicious |
| 8.0 | 99.999999% | 0.000001% | Almost certainly failed |
| 10.0 | 99.99999999% | ~0% | Failure confirmed |

**Why Logarithmic Scale?**
- Compresses probability range [0, 1] → [0, ∞)
- Easier threshold setting (ϕ = 8 vs P = 0.99999999)
- Linear increases in ϕ represent exponential increases in confidence

### Edge Cases in Calculation

#### Zero Variance
```go
if variance == 0 {
    return Prediction{}, ErrZeroVariance
}
```

**Scenario:** All heartbeats arrive at exact intervals (e.g., every 100ms)

**Implication:** Cannot distinguish normal from abnormal delay

**Mitigation:** 
- Requires minimum variance in real-world deployment
- Often indicates synthetic/test data

#### Numerical Stability
```go
if cdf >= 1.0 {
    return math.Inf(1)
}
if math.IsNaN(phiValue) || math.IsInf(phiValue, -1) {
    return math.Inf(1)
}
```

**Issues Handled:**
- `log(0)` → +∞ (when node almost certainly failed)
- Floating-point underflow in CDF calculation
- NaN propagation from invalid inputs

## Configuration Parameters

### Window Size

**Purpose:** Number of recent samples retained

**Typical Values:**
```go
// Conservative: More historical context
windowSize := 200  // 200 samples

// Balanced: Standard deployment
windowSize := 100  // 100 samples (recommended)

// Aggressive: Quick adaptation
windowSize := 50   // 50 samples
```

**Trade-offs:**

| Small Window (50) | Large Window (200) |
|-------------------|-------------------|
| ✓ Fast adaptation to changes | ✓ Stable against outliers |
| ✓ Lower memory usage | ✓ Better statistical confidence |
| ✗ Sensitive to noise | ✗ Slower adaptation |
| ✗ Less statistical power | ✗ Higher memory usage |

### Entry Expiry Time (TTL)

**Purpose:** How long individual samples remain valid

**Typical Values:**
```go
// Short-lived sessions
entryExpiry := 10 * time.Second

// Standard operations
entryExpiry := 30 * time.Second  // Recommended

// Long-running stable systems
entryExpiry := 5 * time.Minute
```

**Relationship to Window Size:**
```
Effective Window = min(windowSize, TTL / avg_heartbeat_interval)
```

**Example:**
- Window size: 100
- TTL: 30 seconds
- Heartbeat interval: 500ms
- Effective: min(100, 30s / 0.5s) = min(100, 60) = 100 ✓

### Suspicion Thresholds

**Default Configuration:**
```go
SuspicionLevel{
    AccumulationThreshold: 8.0,  // Alert
    UpperBoundThreshold:   1.0,  // Warning
}
```

**Application-Specific Tuning:**

```go
// Mission-critical database (prefer false positives)
SuspicionLevel{
    AccumulationThreshold: 5.0,  // More aggressive
    UpperBoundThreshold:   0.5,
}

// Non-critical service (prefer false negatives)
SuspicionLevel{
    AccumulationThreshold: 12.0, // More conservative
    UpperBoundThreshold:   3.0,
}

// Highly variable network
SuspicionLevel{
    AccumulationThreshold: 10.0, // Account for jitter
    UpperBoundThreshold:   2.0,
}
```

### Context Timeout

**Purpose:** Maximum time for Redis operations

**Configuration:**
```go
detector.ContextTimeout = 30 * time.Second  // Default

// Low-latency requirement
detector.ContextTimeout = 5 * time.Second

// High-latency network
detector.ContextTimeout = 60 * time.Second
```

**Considerations:**
- Should exceed worst-case Redis RTT
- Affects overall detection latency
- Balance between responsiveness and reliability

## Integration Patterns

### ChunkServer Health Monitoring

```go
// Setup
detector, _ := NewFailureDetector(
    "chunk-server-1", 100,
    &redis.Options{Addr: "redis:6379"},
    30*time.Second,
    SuspicionLevel{AccumulationThreshold: 8.0, UpperBoundThreshold: 1.0},
)

// Heartbeat loop
ticker := time.NewTicker(500 * time.Millisecond)
for range ticker.C {
    start := time.Now()
    
    // Send heartbeat to master
    err := masterRPC.Heartbeat(context.Background(), &HeartbeatRequest{
        ServerID: "chunk-1",
        Timestamp: start,
    })
    
    end := time.Now()
    
    // Record network measurement
    networkData := NetworkData{
        ForwardTrip: TripInfo{
            SentAt:     start,
            ReceivedAt: start.Add(end.Sub(start) / 2),
        },
        BackwardTrip: TripInfo{
            SentAt:     start.Add(end.Sub(start) / 2),
            ReceivedAt: end,
        },
    }
    
    detector.RecordSample(networkData)
}
```

### Master Server Failure Detection

```go
// Periodic health check
go func() {
    checkInterval := 2 * time.Second
    ticker := time.NewTicker(checkInterval)
    
    for range ticker.C {
        pred, err := detector.PredictFailure()
        if err != nil {
            log.Warn().Err(err).Msg("Prediction failed")
            continue
        }
        
        log.Info().
            Float64("phi", pred.Phi).
            Str("status", string(pred.Message)).
            Msg("Master health")
        
        switch pred.Message {
        case AccumulationThresholdAlert:
            // Master likely failed
            log.Error().Msg("Master server suspected failed")
            initiateMasterFailover()
            
        case UpperBoundThresholdAlert:
            // Warning level
            log.Warn().Msg("Master server experiencing delays")
            increasHeartbeatFrequency()
            
        case ResetThresholdAlert:
            // All good
            resetToNormalOperation()
        }
    }
}()
```

### Distributed Consensus Integration

```go
// Raft leader failure detection
type RaftNode struct {
    detector *FailureDetector
    // ... other fields
}

func (rn *RaftNode) monitorLeader() {
    for {
        pred, err := rn.detector.PredictFailure()
        if err != nil {
            continue
        }
        
        if pred.Phi >= 8.0 {
            // High confidence leader is down
            rn.startElection()
        }
    }
}
```

## Performance Characteristics

### Time Complexity

| Operation | Detector | SamplingWindow | Redis Operations |
|-----------|----------|----------------|------------------|
| `RecordSample()` | O(1) | O(log n) | ZADD (2x), SET (1x) |
| `PredictFailure()` | O(n) | O(n) | ZREVRANGE, MGET |
| `Window.Add()` | - | O(log n) | Pipeline: 3-6 ops |
| `Window.Get()` | - | O(n) | MGET (batch) |
| `Window.clean()` | - | O(k log n) | k = removed items |

### Space Complexity

**Redis Memory Usage:**
```
Total = n * (ID_size + Timestamp_size + JSON_Entry_size)

Where:
- n = window size
- ID_size ≈ 36 bytes (UUID string)
- Timestamp_size ≈ 8 bytes (sorted set score)
- JSON_Entry_size ≈ 100-150 bytes

Example (windowSize = 100):
= 100 * (36 + 8 + 125)
= 100 * 169 bytes
≈ 17 KB per detector instance
```

**Multi-Server Deployment:**
```
Total Memory = num_servers * window_size * entry_size
= 1000 servers * 100 samples * 169 bytes
≈ 16.9 MB (manageable)
```

### Benchmark Results

Expected performance on commodity hardware (4-core CPU, 16GB RAM):

```
BenchmarkRecordSample-4          50000    25000 ns/op     Redis RTT dominated
BenchmarkPredictFailure-4        10000   120000 ns/op     Statistical computation
BenchmarkWindowAdd-4             40000    30000 ns/op     Redis pipeline
BenchmarkWindowGet-4             20000    60000 ns/op     MGET + unmarshaling

Throughput:
- RecordSample: ~40,000 ops/sec
- PredictFailure: ~8,000 ops/sec
```

### Network Overhead

**Per Sample Recording:**
```
Redis Operations: 4 commands (pipelined)
- SET item:{id}: ~200 bytes
- ZADD main_set: ~50 bytes
- ZADD expired_set: ~50 bytes
- ZCARD: ~20 bytes
Total: ~320 bytes/sample
```

**Per Prediction:**
```
Redis Operations:
- ZREVRANGE: ~40 bytes
- MGET (n items): n * 150 bytes
Total (n=100): ~15 KB
```

## Error Handling Strategy

### Error Types and Recovery

```go
// Insufficient Data Errors
ErrNotEnoughHistoricalSamples → Wait for more samples
ErrInsufficientIntervalData   → Continue recording

// Statistical Errors
ErrZeroVariance → Indicates synthetic data or perfect clock
ErrInvalidPhi   → Numerical instability, log as anomaly

// Operational Errors
ErrHistoricalSampling → Redis connectivity issue, retry
ErrAlreadyShutdown    → Graceful degradation
```

### Resilience Patterns

#### Redis Connection Loss
```go
err := detector.RecordSample(data)
if errors.Is(err, redis.ErrClosed) {
    // Attempt reconnection
    detector.Window.reconnect()
    // Retry with exponential backoff
}
```

#### Insufficient Samples
```go
pred, err := detector.PredictFailure()
if errors.Is(err, ErrNotEnoughHistoricalSamples) {
    // Fall back to timeout-based detection
    if time.Since(lastHeartbeat) > 10*time.Second {
        return ALERT
    }
}
```

## Testing Strategy

### Unit Tests

1. **ϕ Calculation Correctness**
   - Known statistical distributions
   - Edge cases (zero variance, extreme values)
   - Numerical stability

2. **Window Operations**
   - TTL expiration
   - Size limit enforcement
   - Concurrent access

3. **Thread Safety**
   - Race condition detection (go test -race)
   - Shutdown idempotency
   - Concurrent RecordSample/PredictFailure

### Integration Tests

1. **Redis Integration**
   - Connection failure handling
   - Data persistence across restarts
   - Pipeline operation correctness

2. **Statistical Behavior**
   - Gradual phi increase with delays
   - Correct threshold triggering
   - Adaptation to changing patterns

### Simulation Tests

```go
func TestFailureDetectionAccuracy(t *testing.T) {
    detector := setupDetector()
    
    // Phase 1: Establish baseline (100ms heartbeats)
    for i := 0; i < 100; i++ {
        recordHeartbeat(100 * time.Millisecond)
        time.Sleep(100 * time.Millisecond)
    }
    
    // Phase 2: Simulate failure (no heartbeats)
    time.Sleep(2 * time.Second)
    
    // Verify high phi
    pred, _ := detector.PredictFailure()
    assert.Greater(t, pred.Phi, 8.0)
}
```

## Limitations and Considerations

### 1. Clock Synchronization
**Issue:** Relies on synchronized clocks across nodes

**Mitigation:**
- Deploy in same region/datacenter
- Use NTP or PTP for clock sync
- Validate timestamp ordering in TripInfo.Valid()

### 2. Network Asymmetry
**Issue:** Assumes symmetric forward/backward latencies

**Reality:** Network paths may differ

**Impact:** Calculated round-trip may not reflect true delays

### 3. Redis as SPOF
**Issue:** Redis failure breaks failure detection

**Mitigation:**
- Redis Cluster for HA
- Local memory fallback
- Circuit breaker pattern

### 4. Memory Constraints
**Issue:** Large-scale deployments (10K+ servers)

**Calculation:**
```
10,000 servers × 100 samples × 169 bytes ≈ 169 MB
```

**Mitigation:**
- Reduce window size
- Shorter TTL
- Hierarchical detection (monitor groups, not individuals)

## Future Enhancements

### 1. Adaptive Thresholds
Automatically adjust AccumulationThreshold based on historical false positive/negative rates.

### 2. Multi-Modal Distribution Support
Detect and handle bimodal/multimodal latency distributions using mixture models.

### 3. Compression
Store deltas instead of absolute timestamps to reduce memory.

### 4. Distributed Coordination
Gossip protocol for sharing suspicion levels across detectors.

### 5. Machine Learning Integration
Learn optimal window sizes and thresholds from operational data.

## References

- Hayashibara, N., Défago, X., Yared, R., & Katayama, T. (2004). **The φ Accrual Failure Detector**. _23rd IEEE International Symposium on Reliable Distributed Systems_.
- [Phi Accrual Failure Detection - Arpit Bhayani](https://medium.com/@arpitbhayani/phi-%CF%86-accrual-failure-detection-79c21ce53a7a)
- [Apache Cassandra: Failure Detection](https://cassandra.apache.org/doc/latest/cassandra/operating/failure_detection.html)
- [Akka Documentation: Phi Accrual Failure Detector](https://doc.akka.io/docs/akka/current/typed/failure-detector.html)
- Google File System (GFS) Paper (2003)
- Hercules ChunkServer Design Documentation
