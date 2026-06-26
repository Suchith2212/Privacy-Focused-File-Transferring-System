# GhostDrop Assignment 4 Viva Questions

This document is for local practice only.

## Sharding Design

1. Why did you choose `vault_id` as the shard key instead of `outer_token`?
	- Because every child table already carries `vault_id`, so it gives one-hop routing for the full data model. `outer_token` is user-facing, but using it would force secondary lookups for child rows and add cross-shard dependency.
2. Why is `vault_id` better than `created_at` for partitioning in your system?
	- `vault_id` is immutable, high-cardinality, and naturally present in every vault-scoped operation. `created_at` is monotonic, so it creates hot shards and is a worse fit for balanced writes.
3. What problem does hash-based sharding solve that range-based sharding does not solve well?
	- Hash sharding gives uniform distribution without depending on insertion order. Range sharding is simpler to reason about, but it tends to concentrate new writes and makes rebalancing harder.
4. Why did you use `parseInt(vaultId[0], 16) % 3` instead of hashing the full UUID?
	- It is a simple deterministic mapping that is easy to explain and verify in viva. For a UUID v4, the first hex digit is already random enough to distribute load reasonably across three shards.
5. How does your routing remain deterministic across all requests?
	- The routing function is pure: the same `vault_id` always maps to the same shard index. That means inserts, reads, and child-row operations all resolve identically every time.
6. Why is it important that all child rows stay on the same shard as the parent vault?
	- It keeps vault creation and updates atomic inside one database. If child rows were split across shards, every vault operation would need distributed coordination and cross-shard joins.
7. What would break if `files` and `inner_tokens` were stored on different shards?
	- Lookups and updates would need a network round-trip to multiple shards for one logical vault action. That would increase latency, complicate constraints, and weaken transactional correctness.
8. How does your design avoid cross-shard JOINs?
	- By co-locating all vault-scoped tables on the same shard and routing them through the same `vault_id`. Joins stay local inside one MySQL instance, so the database can execute them normally.
9. Why does your system not require a distributed transaction coordinator for vault creation?
	- Vault creation is entirely single-shard once the shard is chosen. The insert into `vaults` and the related child inserts happen inside one local transaction, so there is no multi-node commit problem.
10. What is the practical difference between logical sharding and physical sharding in your implementation?
	- Logical sharding means the application splits the dataset by rule; physical sharding means those splits live on separate servers. Your Assignment 4 uses real remote MySQL nodes, so it is physical sharding.

## Shard Infrastructure

11. What are the exact three shard servers you used, and how do they differ?
	- The three shards run on ports 3307, 3308, and 3309 with the same `Dragon` schema. They differ only by shard identity and the data routed to each one.
12. How do you verify that each shard is actually isolated?
	- Each shard is checked through its own connection and `shard_meta` identity record. I also verify that the per-shard row counts and routed records match the expected shard mapping.
13. What role does the `shard_meta` table play?
	- It is a verification table that confirms the shard identity, port, and hex range. That makes it easier to prove that the right data landed on the right server.
14. How do you know the data migration did not lose or duplicate rows?
	- The migration script prints source count, migrated count, per-shard counts, and an integrity check. If the totals match and errors are zero, the migration preserved the dataset.
15. Why is `sessions` treated differently from vault-scoped tables?
	- `sessions` is not owned by one vault, so it cannot be routed by `vault_id`. Replicating it to all shards keeps auth-related checks local without introducing another lookup table.
16. What is the downside of replicating `sessions` to all shards?
	- It increases write traffic and can create brief consistency lag if one shard is delayed. The benefit is simpler routing and local foreign-key enforcement for session-related operations.
17. Why is `Promise.allSettled` better than sequential querying in your scatter path?
	- It queries all shards in parallel and still returns healthy results if one shard fails. Sequential querying would be slower and would hide healthy results behind a failing shard.
18. What happens if one shard fails during an `outer_token` lookup?
	- The router still checks the remaining shards and returns the first successful match if one exists. If the vault is only on the failed shard, the request degrades gracefully with an error for that shard’s data.
19. What happens if one shard fails during a range query?
	- The query can still return partial results from the surviving shards because the fan-out uses `Promise.allSettled`. That is a deliberate availability trade-off for non-shard-key queries.
20. Why did you accept read amplification for non-shard-key queries?
	- Because the common path is shard-key-based and fast, while non-shard-key queries are less frequent and can tolerate extra work. This is a normal trade-off in sharded systems.

## Failure and Performance

21. How does your system behave when shard_0 is down?
	- Only the vaults mapped to shard_0 are affected. The other shards continue to work, so the system partially degrades instead of failing completely.
22. What percentage of vaults are affected if shard_0 fails, and why?
	- About 37.5% of vaults are mapped to shard_0 because 6 of the 16 hex digits map there under `mod 3`. That percentage comes from the routing rule, not from a special-case value.
23. Why is your shard distribution slightly uneven?
	- Because 16 hex digits do not divide evenly by 3. The mapping gives one shard six digits and the other two shards five each, so shard_0 is slightly larger.
24. How did you calculate the 37.5%, 31.25%, 31.25% split?
	- I counted the 16 hex digits and grouped them by `digit % 3`. Six digits map to shard_0 and five digits each map to shard_1 and shard_2, which becomes 6/16, 5/16, and 5/16.
25. Is the distribution problem serious in practice for UUID v4? Why or why not?
	- Not for this workload, because UUID v4 values are random and the imbalance is small. At larger scale, the slight skew can be corrected with virtual nodes or remapping.
26. What would you change if the distribution imbalance became a real performance issue?
	- I would introduce virtual buckets or a lookup table so shards can own multiple logical ranges. That gives finer control over balancing without changing the application model.
27. What are virtual nodes, and how would they help your design?
	- Virtual nodes are logical partitions mapped onto physical shards. They help redistribute load more evenly and make rebalancing easier when one shard becomes hotter than the others.
28. Why did you not use a directory-based shard lookup table?
	- A directory adds one more lookup and can become a bottleneck or a single point of failure. Since the shard key is computable directly, a directory would add complexity without much benefit.
29. What is the bottleneck of a directory-based sharding approach?
	- Every operation depends on the directory being available and fast. That extra hop can reduce throughput and makes the routing layer a central point of contention.
30. What is the main scalability advantage of your current router design?
	- It keeps shard-key operations O(1) and local to one shard. That means the common path scales horizontally without requiring a global coordinator.

## Consistency and CAP

31. What is the main consistency trade-off of your design?
	- I preserve strong consistency inside a shard, but I give up global transactionality across shards. That is the price of avoiding distributed commits.
32. How would you explain the CAP position of your system?
	- The system is CA within a single shard, because MySQL provides ACID locally. Across shards, it behaves more like AP under partial failure because healthy shards can still serve requests.
33. Give the formal definitions of consistency, availability, and partition tolerance.
	- Consistency means every read returns the most recent committed write or an error. Availability means every request gets a non-error response, and partition tolerance means the system continues operating even when nodes cannot communicate.
34. Is your system CA, CP, or AP? Explain carefully and separately for single-shard and multi-shard behavior.
	- Single-shard behavior is CA because the local database is strongly consistent and responds normally. System-wide behavior under shard failure is closer to AP because the router can keep serving healthy shards while the affected shard is unavailable.
35. Why is strong consistency preserved within a shard?
	- Because all related rows for a vault are written in one local MySQL transaction. InnoDB ensures atomic commit, isolation, and durable visibility inside that shard.
36. Why is the system only partially available during a shard outage?
	- Because only the vaults mapped to the failed shard are impacted. The remaining shards can still answer their own requests, so the system does not collapse globally.
37. What is the effect of using shard-key-based routing on latency?
	- It keeps the common path fast because one request goes to one shard. That reduces network hops and makes query latency predictable.
38. What is the latency cost of a scatter-gather query?
	- The latency becomes the slowest shard’s response time plus merge overhead, not the sum if the queries run in parallel. That is still more expensive than a single-shard lookup.
39. Why do range queries require fan-out in your architecture?
	- Because the data is partitioned by shard key, not by time. A time range can span multiple shards, so each shard must be queried and the results merged in the application.
40. Could you support efficient global range queries without fan-out? If yes, how?
	- Not efficiently with the current key design. You would need a different partition strategy, a secondary global index, or a specialized query layer that can prune shards.

## Limitations and Future Work

41. What are the trade-offs of adding a Redis cache for `outer_token` lookups?
	- It would reduce scatter-query latency and offload repeated lookups. The trade-off is cache invalidation complexity and the risk of serving stale mappings.
42. Why did you preserve B+ tree indexes on every shard?
	- Because each shard still needs fast local lookups, and the smaller per-shard dataset makes the indexes more efficient. This preserves the original performance benefits while reducing index size.
43. How does smaller per-shard data size improve index performance?
	- Smaller indexes have fewer pages to traverse and better cache locality. That lowers I/O and makes lookups faster.
44. What would happen if you tried to add a fourth shard later?
	- The routing function would change, so some existing vaults would need to be moved to the new shard. Without rebalancing logic, that would require a controlled migration.
45. How would rebalancing work in your current design?
	- I would migrate the vaults whose new shard mapping changes, dual-write during the cutover, then switch the router and clean up the old copies. That is a staged rebalancing plan.
46. What are the limitations of not having automatic rebalancing?
	- The system cannot adapt to growth or skew by itself. If one shard gets too hot or you add new shards, you need a manual migration process.
47. Why is your current design more production-like than a simple mock sharding demo?
	- Because it uses real remote MySQL servers, actual routed inserts, real migration, and integrity verification. It is not just a code mock; it exercises a live distributed setup.
48. What exact evidence in your report proves data integrity after migration?
	- The migration section shows source count, migrated count, per-shard counts, and a pass message. Those outputs prove that the total rows were preserved.
49. If the examiner asks whether your system is fully distributed, what would you answer?
	- I would say it is a distributed sharded system with a centralized application router, not a peer-to-peer distributed database. The shards are distributed, but coordination still happens in the app layer.
50. If you had one more week, what is the single most important improvement you would make?
	- I would add automated rebalancing and failover handling. That would make the system more resilient and closer to a production sharded architecture.

## Contact

Use this section locally if you want to keep the viva sheet tied to your submission details.

- Name: Saladi Jayachandra Venkata Naga Suchith
- Roll No: 24110313
- Email: 24110313@iitgn.ac.in
- Project / Team: GhostDrop, Assignment 4

