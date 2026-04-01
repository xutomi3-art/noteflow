# Noteflow Q&A Benchmark Report — Local GPU (Qwen3.5-35B) v3

**Date:** 2026-03-28
**Notebook:** Board meeting (23 sources, 20+ PDF documents)
**Server:** 10.200.0.112 (16 cores, 16GB RAM) + 10.200.0.102 (GPU: RTX 4090 48GB)
**LLM:** qwen3.5 (Qwen3.5-35B-A3B-GPTQ-Int4 via vLLM, 32K context, local GPU)
**Embedding:** bge-m3 via Xinference (local GPU)
**Rerank:** gte-rerank via DashScope
**RAG Config:** top_k=8, vector_weight=0.7, query_rewrite=ON (bilingual EN↔CN, max 15 keywords)
**Answer check:** Strict — responses containing "no information", "not found", "未找到" etc. are marked ~✗

---

## Results

| # | Question | 1st Token | Total | Cit | Result |
|--:|----------|----------:|------:|----:|:------:|
| 1 | Tell me about technology at SAS | 1.6s | 10.9s | 3 | ✓ |
| 2 | Are there any Board policies for student travel? | 1.6s | 6.0s | 3 | ✓ |
| 3 | When was SAS founded? | 1.5s | 1.9s | 1 | ✓ |
| 4 | When was the Board last expanded? | 1.6s | 3.2s | 3 | ~✗ |
| 5 | Tell me what the policy says about Board members. Do they have to be parents? | 1.7s | 3.9s | 3 | ✓ |
| 6 | Can you tell me anything about historical tuition? | 2.0s | 13.9s | 5 | ✓ |
| 7 | What can you tell me about school tuition? | 1.6s | 12.3s | 5 | ✓ |
| 8 | What kind of school is SAS? | 1.5s | 3.7s | 3 | ✓ |
| 9 | How does SAS tuition compare to other schools in the Shanghai market? | 1.7s | 7.6s | 2 | ✓ |
| 10 | Who are the other Tier 1 international schools in Shanghai? | 1.8s | 7.0s | 2 | ✓ |
| 11 | Do school trips count as school absences? | 1.5s | 3.9s | 1 | ✓ |
| 12 | Can parents or guardians take students home directly from a field trip site? | 1.6s | 2.8s | 2 | ✓ |
| 13 | How does SAS differentiate the two campuses Puxi and Pudong? | 1.6s | 8.1s | 4 | ✓ |
| 14 | What projects were scheduled for 2024? | 2.0s | 4.5s | 2 | ✓ |
| 15 | What are the current school priorities? | 1.6s | 7.1s | 4 | ✓ |
| 16 | How does SAS compare to its benchmark schools? | 1.9s | 3.3s | 2 | ~✗ |
| 17 | What about college admissions? | 1.6s | 13.0s | 2 | ✓ |
| 18 | Tell me about best fit | 1.5s | 3.4s | 1 | ✓ |
| 19 | Tell me about strategic differentiation | 1.7s | 3.2s | 1 | ✓ |
| 20 | What are the school's biggest challenges? Biggest opportunities? | 1.5s | 9.1s | 3 | ✓ |
| 21 | Tell me more about SAS's Shenzhen campus | 1.6s | 3.7s | 2 | ~✗ |
| 22 | When was SAS founded? (repeat) | 1.4s | 2.0s | 1 | ✓ |
| 23 | 介绍一下上海美国学校（SAS）的技术相关情况 | 1.7s | 11.4s | 3 | ✓ |
| 24 | 学校是否有针对学生出行的董事会政策？ | 1.9s | 6.3s | 3 | ✓ |
| 25 | 上海美国学校（SAS）成立于哪一年？ | 1.6s | 2.0s | 1 | ✓ |
| 26 | 学校董事会最近一次扩充人员是在什么时候？ | 2.1s | 3.5s | 1 | ~✗ |
| 27 | 请说明学校关于董事会成员的相关政策规定。成员必须是学生家长吗？ | 1.7s | 6.9s | 4 | ✓ |
| 28 | 你能介绍一下学校过往的学费情况吗？ | 1.5s | 11.6s | 5 | ✓ |
| 29 | 关于学校学费，你能提供哪些信息？ | 1.5s | 10.5s | 4 | ✓ |
| 30 | 上海美国学校（SAS）是一所什么类型的学校？ | 1.5s | 3.4s | 4 | ✓ |
| 31 | 上海美国学校（SAS）的学费与上海市场上的其他学校相比如何？ | 1.7s | 6.0s | 2 | ✓ |
| 32 | 上海还有哪些其他的一线国际学校？ | 2.3s | 4.9s | 2 | ✓ |
| 33 | 学校组织的外出研学活动会算作学生缺勤吗？ | 1.7s | 2.9s | 1 | ✓ |
| 34 | 家长或监护人可以直接从研学活动地点接学生回家吗？ | 1.8s | 3.2s | 1 | ✓ |
| 35 | 上海美国学校的浦西校区和浦东校区有哪些区别？ | 1.8s | 9.3s | 3 | ✓ |
| 36 | 学校 2024 年规划了哪些项目？ | 2.1s | 7.5s | 4 | ✓ |
| 37 | 学校当前的工作重点是什么？ | 1.8s | 8.0s | 2 | ✓ |
| 38 | 上海美国学校（SAS）与其对标学校相比表现如何？ | 2.1s | 4.8s | 2 | ~✗ |
| 39 | 大学录取情况如何？ | 1.6s | 3.1s | 2 | ~✗ |
| 40 | 谈谈 "最佳适配" 的相关理念 | 1.6s | 5.2s | 1 | ✓ |
| 41 | 谈谈学校的战略差异化发展 | 1.6s | 7.7s | 4 | ~✗ |
| 42 | 学校目前面临的最大挑战是什么？最大机遇又是什么？ | 1.6s | 8.3s | 3 | ✓ |
| 43 | 详细介绍一下上海美国学校（SAS）的深圳校区 | 2.2s | 4.1s | 2 | ~✗ |
| 44 | 上海美国学校（SAS）成立于哪一年？(repeat) | 1.6s | 2.1s | 1 | ✓ |

---

## Summary

| Metric | Local GPU (strict) | Cloud (previous) | Delta |
|--------|-------------------|-------------------|-------|
| Total questions | 44 | 44 | — |
| **Actually answered** | **35/44 (80%)** | **40/44 (91%)** | **-11%** |
| Has citations but "not found" | 9 | 2 | +7 |
| English answered | 19/22 (86%) | 21/22 (95%) | -9% |
| Chinese answered | 16/22 (73%) | 19/22 (86%) | -13% |
| Avg first token (EN) | **1.6s** | 3.5s | **2.2x faster** |
| Avg first token (CN) | **1.8s** | 4.2s | **2.3x faster** |
| Avg total response time | **5.9s** | 13.1s | **2.2x faster** |
| Fastest response | 1.9s (Q3/Q22/Q25) | 4.7s (Q25) | **2.5x faster** |
| Slowest response | 13.9s (Q6) | 23.7s (Q28) | **1.7x faster** |
| Avg citations per response | 2.5 | 4.3 | -1.8 |

---

## Failed/Partial Questions Analysis

| # | Question | Status | Analysis |
|---|----------|--------|----------|
| 4 | When was the Board last expanded? | ~✗ | "no information regarding" — same as cloud. Info genuinely not in docs. |
| 16 | How does SAS compare to its benchmark schools? | ~✗ | "does not contain direct comparative data" — cloud succeeded. Small model can't synthesize scattered data. |
| 21 | Tell me more about SAS's Shenzhen campus | ~✗ | SAS has no Shenzhen campus. Correct rejection. Same as cloud. |
| 26 | 学校董事会最近一次扩充人员是在什么时候？ | ~✗ | Chinese version of Q4. Same root cause — info not in docs. |
| 38 | SAS与其对标学校相比表现如何？ | ~✗ | Chinese version of Q16. Same issue — small model can't cross-reference. |
| 39 | 大学录取情况如何？ | ~✗ | NEW failure vs cloud. Small model said "not found" while cloud succeeded. |
| 41 | 谈谈学校的战略差异化发展 | ~✗ | NEW failure vs cloud. Abstract topic requires more reasoning depth. |
| 43 | 详细介绍一下SAS的深圳校区 | ~✗ | Chinese version of Q21. Correct rejection. |

### Failure Categories
- **Info not in docs** (correct rejection): Q4, Q21, Q26, Q43 — 4 questions
- **Small model synthesis weakness**: Q16, Q38, Q39, Q41 — 4 questions (cloud succeeded on these)
- **True new failure**: 1 question (Q39 大学录取)

---

## Comparison: Local GPU vs Cloud

### Speed: Local wins by 2.2x
- First token: **1.7s** vs 3.8s
- Total: **5.9s** vs 13.1s
- EN/CN parity on local (both ~1.7s), cloud had 0.7s CN overhead

### Answer quality: Cloud wins by 11%
- Local: 80% (35/44) vs Cloud: 91% (40/44)
- 4 questions are correctly rejected (info not in docs) — real gap is 35 vs 40 on answerable questions
- Small model (3B active params) struggles with: cross-document synthesis, abstract reasoning, scattered evidence

### Citations: Cloud is more thorough
- Local: 2.5 citations/response vs Cloud: 4.3
- Cloud provides more comprehensive multi-source evidence

### Cost
- Local GPU: **$0/query** (hardware amortized)
- Cloud: ~¥0.02-0.05/query

---

## Recommendations

1. **Use local GPU as primary** for speed-sensitive use cases (2.2x faster, $0 cost)
2. **Cloud backup is critical** for quality — auto-fallback catches the 11% gap
3. **Consider cloud for "deep thinking" mode** — route complex multi-document questions to cloud qwen3.5-plus
4. **Q39 (大学录取)** — investigate why local model fails; may need better chunk retrieval for this topic
5. **Context window** — 32K is sufficient for most queries but limits multi-source synthesis; consider increasing to 65K if GPU memory allows
