# Ghost Drop Path Benchmark Summary

This benchmark compares the Module A B+ Tree wrapper against the brute-force baseline on Ghost Drop-shaped access paths derived from the exported project snapshot.

Source snapshot: `F:\SEM IV\lessons\DB\Project\Project_Assignments\Assignment2\Ghost_Drop\backend\database_export.json`

Measured points: `20`

Runs per point: `1`

| Size | Load (B+) ms | Load (Brute) ms | Outer B+ ms | Outer Brute ms | Expiry B+ ms | Expiry Brute ms | File B+ ms | File Brute ms | Auth B+ ms | Auth Brute ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | 4.0927 | 29.4242 | 0.0082 | 0.0053 | 0.0069 | 0.0222 | 0.0047 | 0.0287 | 0.0053 | 0.0249 |
| 1,500 | 15.7259 | 264.0798 | 0.0092 | 0.0194 | 0.0080 | 0.0622 | 0.0070 | 0.0997 | 0.0115 | 0.0872 |
| 2,500 | 30.8319 | 752.7358 | 0.0088 | 0.0510 | 0.0097 | 0.1249 | 0.0085 | 0.1726 | 0.0172 | 0.1363 |
| 3,500 | 46.0340 | 1756.8995 | 0.0124 | 0.1081 | 0.0125 | 0.2055 | 0.0107 | 0.3377 | 0.0237 | 0.3295 |
| 4,500 | 91.8389 | 4075.0261 | 0.0151 | 0.1703 | 0.0212 | 0.4212 | 0.0171 | 0.5161 | 0.0442 | 0.2548 |
| 5,500 | 134.0672 | 5793.7758 | 0.0083 | 0.0898 | 0.0129 | 0.2483 | 0.0086 | 0.8148 | 0.0472 | 0.3737 |
| 6,500 | 149.3407 | 8184.1721 | 0.0157 | 0.1702 | 0.0112 | 0.4101 | 0.0121 | 0.4016 | 0.0574 | 0.8522 |
| 7,500 | 200.4794 | 10700.1995 | 0.0161 | 0.3492 | 0.0188 | 0.6677 | 0.0207 | 1.7587 | 0.3050 | 0.8176 |
| 8,500 | 278.2677 | 11343.0397 | 0.0097 | 0.1442 | 0.0158 | 0.3616 | 0.0114 | 0.5452 | 0.0542 | 0.4569 |
| 9,500 | 159.1085 | 11188.4119 | 0.0107 | 0.1868 | 0.0119 | 0.8714 | 0.0195 | 1.0534 | 0.0770 | 0.6943 |
| 10,500 | 316.4175 | 22409.9314 | 0.0112 | 0.3609 | 0.0136 | 0.7511 | 0.0150 | 1.6419 | 0.1326 | 1.6916 |
| 11,500 | 321.5850 | 31750.5945 | 0.0217 | 0.5490 | 0.0541 | 1.1133 | 0.0170 | 0.8672 | 0.0839 | 0.4524 |
| 12,500 | 404.4604 | 34778.3073 | 0.0122 | 0.3558 | 0.0142 | 0.7311 | 0.0155 | 1.7587 | 0.1678 | 1.1251 |
| 13,500 | 522.8266 | 34670.2935 | 0.0127 | 0.2522 | 0.0207 | 0.7442 | 0.0146 | 1.3336 | 0.1121 | 1.3916 |
| 14,500 | 375.4331 | 41871.2023 | 0.0116 | 0.2198 | 0.0142 | 0.8888 | 0.0153 | 0.9008 | 0.0844 | 0.9212 |
| 15,500 | 471.7006 | 35738.8356 | 0.0118 | 0.2456 | 0.0234 | 0.7475 | 0.0117 | 0.8168 | 0.1745 | 0.8639 |
| 16,500 | 320.6454 | 35219.3507 | 0.0104 | 0.2416 | 0.0138 | 0.9108 | 0.0144 | 1.0327 | 0.1243 | 0.8989 |
| 17,500 | 371.6960 | 38675.8064 | 0.0146 | 0.2441 | 0.0197 | 0.8547 | 0.0217 | 1.2737 | 0.1954 | 1.2377 |
| 18,500 | 374.6729 | 43910.0529 | 0.0168 | 0.7532 | 0.0325 | 1.9881 | 0.0222 | 2.8808 | 0.2772 | 2.0339 |
| 19,500 | 429.8621 | 77229.0501 | 0.0125 | 0.2056 | 0.0160 | 0.9206 | 0.0177 | 1.2076 | 0.1048 | 1.0977 |

## Interpretation

- The benchmark starts from the real exported project snapshot and amplifies it into larger deterministic datasets.
- Point lookups remain close to constant for the B+ Tree while brute-force time grows with dataset size.
- Range scans widen the gap further because the tree can traverse linked leaves instead of rescanning the entire structure.
- This gives a stronger Module A story than a purely synthetic integer-key benchmark.
- The dashboard and speedup plots make the four domain paths easy to compare in one place.

## Speedup Summary

- Outer lookup: average speedup `17.6x`, peak speedup `44.8x`
- Expiry range: average speedup `36.7x`, peak speedup `73.2x`
- File range: average speedup `62.0x`, peak speedup `129.8x`
- Auth range: average speedup `8.4x`, peak speedup `14.8x`


