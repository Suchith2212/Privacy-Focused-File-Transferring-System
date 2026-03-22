# Module A Plot Explanations

This document gives a plot-by-plot explanation for every benchmark figure packaged in Module A. It is meant to help an evaluator understand what each image shows, why it matters, and how it supports the performance story of the submission.

## 1. Domain benchmark plots in `integration/`

These plots come from the BlindDrop-shaped benchmark in `integration/benchmark_blinddrop_paths.py`. They use the exported project snapshot as the starting point and expand it into larger deterministic datasets.

### `benchmark_outer_lookup.png`

This plot compares exact outer-token lookup time for the B+ Tree wrapper and the brute-force baseline as dataset size increases.

What it shows:

- the B+ Tree lookup line stays close to flat across the sweep
- the brute-force line grows as more rows must be scanned
- the gap becomes larger at higher sizes

Why it matters:

- outer-token lookup is the simplest point-query path in the BlindDrop domain
- this plot shows that the tree behaves correctly for exact-search workloads, not only for range scans

How to describe it:

- exact lookups remain nearly constant for the B+ Tree because navigation is guided by ordered keys
- brute force becomes slower because it still depends on scanning through more records

### `benchmark_expiry_range.png`

This plot compares expiry-window range scan time between the B+ Tree wrapper and brute force.

What it shows:

- the B+ Tree stays much faster than brute force across the measured sizes
- the performance gap is larger than in exact lookup
- the gap widens as the dataset grows

Why it matters:

- expiry processing is naturally a range query over time-ordered values
- this is exactly the kind of workload where linked B+ Tree leaves should help

How to describe it:

- the tree can jump to the first key in the expiry window and then continue through neighboring leaves
- brute force must still test rows one by one across a much larger search space

### `benchmark_file_range.png`

This plot compares the vault-file listing path, indexed by `(vault_id, status, created_at_epoch)`, against brute force.

What it shows:

- this is the strongest range-scan result in the packaged domain benchmark
- the B+ Tree remains low-latency while brute force grows sharply with dataset size
- the packaged benchmark summary reports the highest average speedup on this path

Why it matters:

- file listing inside a vault is a realistic ordered retrieval task in the project domain
- this plot demonstrates the advantage of composite ordered keys plus linked-leaf traversal

How to describe it:

- once the tree reaches the starting composite key, it can read the relevant ordered slice efficiently
- brute force has to examine many unrelated rows before isolating the same subset

### `benchmark_auth_range.png`

This plot compares auth-attempt timeline range scans between the B+ Tree and brute force.

What it shows:

- the B+ Tree still performs better throughout the sweep
- the improvement is clear, but smaller than the file-range path
- the lines may look closer than in the expiry/file plots, yet the indexed path still wins consistently

Why it matters:

- not every range workload produces the same magnitude of gain
- this plot makes the benchmark story more credible because it shows a realistic middle case instead of only the most dramatic result

How to describe it:

- the ordered tree still benefits timeline scanning
- the smaller gap likely reflects the distribution of auth events and the way posting lists are used in that path

### `benchmark_path_speedup.png`

This plot aggregates the domain benchmark into comparative speedup curves or summaries for the four BlindDrop-shaped paths.

What it shows:

- all four indexed paths outperform brute force
- the range-oriented paths show larger gains than the point lookup path
- the file-range path is the strongest overall result in the packaged run

Why it matters:

- it gives one summary figure for the domain benchmark instead of forcing the evaluator to mentally combine four separate charts
- it makes relative path strength easy to compare

How to describe it:

- outer lookup proves stable exact-search improvement
- expiry and file paths show the strongest benefit from ordered traversal
- auth-range still improves, but at a more moderate level

## 2. Detailed benchmark plots in `evidence/`

These plots come from `integration/benchmark_detailed.py`. Unlike the domain benchmark, this layer tests the underlying data structure more generically across insertion, search, deletion, selective range queries, mixed workloads, speedup, and memory views.

### `benchmark_operation_dashboard.png`

This dashboard combines the main operation trends into one overview figure.

What it shows:

- insert, search, delete, and range behavior can be compared in one place
- the B+ Tree trends remain consistently better than brute force as the dataset grows
- different operations widen at different rates, which is expected

Why it matters:

- it acts as the quickest summary of the generic benchmark layer
- an evaluator can see the full performance pattern before inspecting each single-operation graph

### `benchmark_insertion.png`

This plot compares insertion cost for the B+ Tree and brute-force baseline.

What it shows:

- insertion grows for both structures as the dataset becomes larger
- the brute-force baseline grows much more sharply
- the B+ Tree remains far lower than brute force at larger sizes

Why it matters:

- insertion requires leaf placement and occasional node splits in the tree
- even with that structural work, the B+ Tree still scales much better than repeated linear growth in the brute-force representation

### `benchmark_search.png`

This plot compares exact-search cost for both approaches.

What it shows:

- the B+ Tree search curve stays very low and relatively stable
- brute-force search rises with dataset size
- the gap is one of the clearest confirmations of the expected logarithmic-versus-linear behavior

Why it matters:

- this is the cleanest generic validation that the core search structure is working as intended
- it supports the same exact-search story seen in the domain outer-token benchmark

### `benchmark_deletion.png`

This plot compares deletion cost for the B+ Tree and brute-force baseline.

What it shows:

- the B+ Tree remains faster even though deletion may require rebalance or merge logic
- brute-force deletion grows more strongly with size because lookup and removal remain list-oriented
- the scaling gap becomes clearer at larger record counts

Why it matters:

- deletion is often the operation where a tree implementation can fail to stay convincing
- this plot helps show that the implementation handles full update lifecycle work, not just inserts and searches

### `benchmark_range.png`

This plot compares selective range-query cost for the two structures.

What it shows:

- the B+ Tree line stays well below brute force across the sweep
- the range benefit is clear, but it is tied to selective windows rather than near full-table scans
- the report notes that the benchmark uses 32 fixed-width windows at about 1% of dataset size

Why it matters:

- it is a more honest range benchmark than scanning almost the entire dataset each time
- it demonstrates the practical value of ordered leaves for targeted retrieval

How to describe it:

- the tree reaches the start of the requested window and walks forward in sorted order
- brute force still pays the cost of broad linear inspection

### `benchmark_random_workload.png`

This plot measures a mixed workload rather than one isolated operation.

What it shows:

- the B+ Tree keeps an advantage when reads and writes are combined
- the plot is less clean than a single-operation graph because it reflects a composite workload
- despite that, the overall trend still favors the indexed structure

Why it matters:

- real usage rarely consists of only one operation repeated forever
- this graph makes the benchmark story less artificial by showing broader operational behavior

### `benchmark_speedup.png`

This plot summarizes relative speedup across the main generic operations.

What it shows:

- the B+ Tree beats brute force across insert, search, delete, and range workloads
- some operations benefit more than others
- it is the generic-benchmark counterpart to `benchmark_path_speedup.png`

Why it matters:

- it gives one compact comparison of where the implementation gains the most
- it is easier to cite in discussion and conclusion sections than repeating four separate graphs

### `benchmark_memory.png`

This plot tracks retained structure size after insert.

What it shows:

- long-lived in-memory size grows with dataset size for both structures
- in the packaged run, the brute-force baseline remains heavier than the B+ Tree
- the report already includes example checkpoints showing that pattern at `1,000` and `21,000` records

Why it matters:

- it distinguishes actual retained structure size from temporary allocation spikes
- it prevents the report from making an unsupported assumption that a tree must always use more memory

### `benchmark_memory_peak_allocations.png`

This plot measures peak Python allocations during the build phase using `tracemalloc`.

What it shows:

- temporary allocation pressure during construction is reported separately from retained structure size
- peak allocation can be higher than retained size because it includes transient objects created during execution

Why it matters:

- without this graph, one memory number could be misleading
- it gives a fairer explanation of runtime allocation behavior while the structure is being built

### `benchmark_memory_after_delete.png`

This plot measures retained structure size after deleting 20% of keys.

What it shows:

- memory is examined after a mutating phase, not only immediately after bulk insert
- it helps show whether the structure remains reasonable after removal work
- it complements the insert-time retained-size plot

Why it matters:

- a data structure should be discussed after both growth and shrinkage
- this makes the memory section more complete and less one-sided

### `benchmark_memory_dashboard.png`

This dashboard combines the three memory views.

What it shows:

- retained size after insert
- peak allocations during build
- retained size after partial delete

Why it matters:

- it gives a single high-level memory summary
- it helps the evaluator see that the submission intentionally separates persistent memory cost from transient allocator peaks

## 3. How to summarize the full plot package

If a short defense line is needed, the full plot set supports three main claims:

- the B+ Tree consistently outperforms the brute-force baseline across exact lookup, selective range queries, and mixed workloads
- the strongest gains appear on ordered range-oriented paths, which matches the linked-leaf design of the data structure
- the benchmark package is more defensible because it reports not only speed, but also mixed-workload and memory behavior through separate, clearly scoped plots
