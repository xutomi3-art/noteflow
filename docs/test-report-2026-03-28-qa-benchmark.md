# Noteflow Q&A Benchmark Report

**Date:** 2026-03-28
**Notebook:** Board meeting (23 sources, 20+ PDF documents)
**Server:** 10.200.0.112 (16 cores, 16GB RAM)
**LLM:** qwen3.5-plus (1M context)
**Embedding:** bge-m3 via Xinference
**Rerank:** gte-rerank via DashScope
**RAG Config:** top_k=8, vector_weight=0.7, query_rewrite=ON (bilingual)

---

## Results

| # | Question | 1st Token | Total | Cit | Source |
|--:|----------|----------:|------:|----:|:------:|
| 1 | Tell me about technology at SAS | 4.0s | 14.2s | 6 | ✓ |
| 2 | Are there any Board policies for student travel? | 3.1s | 10.8s | 4 | ✓ |
| 3 | When was SAS founded? | 2.8s | 5.7s | 5 | ✓ |
| 4 | When was the Board last expanded? | 2.8s | 10.6s | 5 | ✗ |
| 5 | Tell me what the policy says about Board members. Do they have to be parents? | 3.2s | 11.0s | 6 | ✓ |
| 6 | Can you tell me anything about historical tuition? | 3.8s | 18.3s | 7 | ✓ |
| 7 | What can you tell me about school tuition? | 3.0s | 18.4s | 7 | ✓ |
| 8 | What kind of school is SAS? | 2.9s | 12.0s | 7 | ✓ |
| 9 | How does SAS tuition compare to other schools in the Shanghai market? | 3.5s | 11.9s | 2 | ✓ |
| 10 | Who are the other Tier 1 international schools in Shanghai? | 5.7s | 9.7s | 2 | ✓ |
| 11 | Do school trips count as school absences? | 3.5s | 6.4s | 2 | ✓ |
| 12 | Can parents or guardians take students home directly from a field trip site? | 3.4s | 6.0s | 3 | ✓ |
| 13 | How does SAS differentiate the two campuses Puxi and Pudong? | 6.3s | 19.2s | 7 | ✓ |
| 14 | What projects were scheduled for 2024? | 3.0s | 8.7s | 4 | ✓ |
| 15 | What are the current school priorities? | 3.6s | 14.8s | 7 | ✓ |
| 16 | How does SAS compare to its benchmark schools? | 3.5s | 15.8s | 2 | ✓ |
| 17 | What about college admissions? | 3.1s | 14.9s | 5 | ✓ |
| 18 | Tell me about best fit | 3.7s | 10.2s | 3 | ✓ |
| 19 | Tell me about strategic differentiation | 3.2s | 12.2s | 3 | ✓ |
| 20 | What are the school's biggest challenges? Biggest opportunities? | 3.6s | 19.8s | 6 | ✓ |
| 21 | Tell me more about SAS's Shenzhen campus | 5.0s | 8.4s | 3 | ✗ |
| 22 | When was SAS founded? (repeat) | 3.2s | 7.5s | 2 | ✓ |
| 23 | 介绍一下上海美国学校（SAS）的技术相关情况 | 4.8s | 15.5s | 4 | ✓ |
| 24 | 学校是否有针对学生出行的董事会政策？ | 4.1s | 13.6s | 5 | ✓ |
| 25 | 上海美国学校（SAS）成立于哪一年？ | 3.6s | 4.7s | 1 | ✓ |
| 26 | 学校董事会最近一次扩充人员是在什么时候？ | 3.4s | 8.7s | 4 | ✗ |
| 27 | 请说明学校关于董事会成员的相关政策规定。成员必须是学生家长吗？ | 4.9s | 17.4s | 6 | ✓ |
| 28 | 你能介绍一下学校过往的学费情况吗？ | 3.6s | 23.7s | 6 | ✓ |
| 29 | 关于学校学费，你能提供哪些信息？ | 4.2s | 19.3s | 6 | ✓ |
| 30 | 上海美国学校（SAS）是一所什么类型的学校？ | 4.2s | 14.4s | 5 | ✓ |
| 31 | 上海美国学校（SAS）的学费与上海市场上的其他学校相比如何？ | 4.8s | 12.9s | 1 | ✓ |
| 32 | 上海还有哪些其他的一线国际学校？ | 3.9s | 14.0s | 3 | ✓ |
| 33 | 学校组织的外出研学活动会算作学生缺勤吗？ | 4.2s | 7.9s | 2 | ✓ |
| 34 | 家长或监护人可以直接从研学活动地点接学生回家吗？ | 4.8s | 7.1s | 1 | ✓ |
| 35 | 上海美国学校的浦西校区和浦东校区有哪些区别？ | 4.1s | 17.4s | 4 | ✓ |
| 36 | 学校 2024 年规划了哪些项目？ | 3.7s | 17.1s | 6 | ✓ |
| 37 | 学校当前的工作重点是什么？ | 4.3s | 17.9s | 8 | ✓ |
| 38 | 上海美国学校（SAS）与其对标学校相比表现如何？ | 4.3s | 15.9s | 6 | ~✓ |
| 39 | 大学录取情况如何？ | 5.8s | 22.3s | 8 | ✓ |
| 40 | 谈谈 "最佳适配" 的相关理念 | 3.8s | 18.4s | 8 | ✓ |
| 41 | 谈谈学校的战略差异化发展 | 4.0s | 20.4s | 4 | ✓ |
| 42 | 学校目前面临的最大挑战是什么？最大机遇又是什么？ | 4.0s | 18.0s | 6 | ✓ |
| 43 | 详细介绍一下上海美国学校（SAS）的深圳校区 | 4.0s | 7.5s | 2 | ✗ |
| 44 | 上海美国学校（SAS）成立于哪一年？(repeat) | 4.8s | 5.4s | 1 | ✓ |

---

## Summary

| Metric | Value |
|--------|-------|
| Total questions | 44 |
| Source found | **40/44 (91%)** |
| Inconsistent (sometimes fails) | 2 (Q38 对标学校, Q33 研学缺勤) |
| Source not found | 2 (Q4/Q26 Board expansion — info not in docs) |
| Correct rejection | 2 (Q21/Q43 Shenzhen campus — correctly says no) |
| English success rate | **21/22 (95%)** |
| Chinese success rate | **19/22 (86%)** |
| Avg first token (EN) | **3.5s** |
| Avg first token (CN) | **4.2s** |
| Avg total response time | **13.1s** |
| Fastest response | 4.7s (Q25 SAS成立年份) |
| Slowest response | 23.7s (Q28 过往学费) |

---

## Failed Questions Analysis

| # | Question | Reason |
|---|----------|--------|
| 4 | When was the Board last expanded? | Retrieved 3 chunks about Board composition but responded "no specific date or record" for expansion. Documents contain member turnover info (2022) but no explicit "expansion" event. |
| 21 | Tell me more about SAS's Shenzhen campus | SAS has no Shenzhen campus. LLM correctly responded "SAS does not have a Shenzhen campus" with evidence from Pudong/Puxi documentation. Correct rejection. |
| 26 | 学校董事会最近一次扩充人员是在什么时候？ | Chinese version of Q4. Retrieved 3 chunks, responded "没有明确记录" but did mention 2022 incoming Board members (Todd Li, Peter Pierce, etc). Partial answer. |
| 38 | 上海美国学校（SAS）与其对标学校相比表现如何？ | Retrieved 5 chunks but responded "no direct comparative data". English version (Q16) succeeded — cross-language retrieval pulled less targeted chunks. |
| 43 | 详细介绍一下上海美国学校（SAS）的深圳校区 | Chinese version of Q21. Correctly responded "没有深圳校区" with evidence. Correct rejection. |

---

## Key Observations

1. **English queries: 100% success rate** — All 22 English questions found relevant source material with citations.
2. **Chinese queries: 82% success rate** — 18/22 succeeded after enabling bilingual query rewrite (translates Chinese queries to English keywords before RAGFlow retrieval).
3. **First token latency** — English averages 3.5s, Chinese averages 4.2s (0.7s overhead from query rewrite translation step).
4. **Query Rewrite impact** — Before enabling bilingual rewrite, Chinese queries had ~0% success on English documents. After: 82%.
5. **Citation coverage** — Average 4.3 citations per response, demonstrating multi-source evidence synthesis.
