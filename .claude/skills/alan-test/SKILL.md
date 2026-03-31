---
name: alan-test
description: Run SAS Board Knowledge Base test suite — 46 questions with fact-based verification, clear history between each question, generate Markdown report
---

# SAS Board Test — Knowledge Base QA Verification

## Overview

Run 46 predefined questions against the SAS Board Knowledge Base notebook on the **testing environment**, verify answers contain expected facts, and generate a Markdown report.

## Test Configuration

- **Server**: `10.200.0.112` (testing environment, internal network only)
- **Backend**: `http://localhost:8000` (run test script ON the server via SSH)
- **Notebook**: `12d065c7-9c67-4125-b39d-75185e063e09` (Board Meeting)
- **Account**: `testclaude@noteflow.dev / Test1234`
- **SSH**: `root@10.200.0.112` / `Jototech@123`
- **History**: Clear before EVERY question and at start/end
- **Deep Thinking**: Off (normal mode)

## Running

1. Upload the test script to the server:

```bash
sshpass -p 'Jototech@123' scp -o StrictHostKeyChecking=no /tmp/sas_test_v4.py root@10.200.0.112:/tmp/sas_test_v4.py
```

2. Run the test on the server (takes ~15-20 minutes):

```bash
sshpass -p 'Jototech@123' ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=60 root@10.200.0.112 "
TOKEN=\$(curl -s http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{\"email\":\"testclaude@noteflow.dev\",\"password\":\"Test1234\"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"access_token\"])')
nohup python3 /tmp/sas_test_v4.py \"\$TOKEN\" > /tmp/sas_report.md 2>/tmp/sas_test.log &
echo 'Started PID:' \$!
"
```

3. Monitor progress:

```bash
sshpass -p 'Jototech@123' ssh root@10.200.0.112 "tail -5 /tmp/sas_test.log"
```

4. Download report when done:

```bash
sshpass -p 'Jototech@123' scp root@10.200.0.112:/tmp/sas_report.md docs/test-report-sas-board-$(date +%Y-%m-%d).md
```

## Test Script

The test script should be created at `/tmp/sas_test_v4.py` before running. Key parameters:

```python
BASE = "http://localhost:8000"
NB = "12d065c7-9c67-4125-b39d-75185e063e09"
```

## Evaluation Logic

Each question has an `expect_type`:

### `expect_type: "found"` (44 questions)
- **PASS**: Answer contains at least one expected keyword AND the first 250 chars do NOT contain "not found" language
- **FAIL**: No keywords matched, OR answer opens with "not found" language

### `expect_type: "not_found"` (2 questions — Shenzhen campus)
- **PASS**: Answer correctly states the information doesn't exist
- **FAIL**: Answer fabricates information

### "Not found" detection phrases
```
"no information", "no specific", "not found", "do not contain",
"does not contain", "does not have", "no relevant", "cannot find",
"not available", "not mentioned", "no mention", "no data",
"没有提到", "未提及", "没有找到", "无法找到", "没有相关",
"文档中没有", "不包含", "没有包含", "无法确定", "没有记录", "不存在"
```

## Questions & Expected Facts (46 total)

| # | Question | Type | Expected Keywords |
|---|---------|------|-------------------|
| 1 | Tell me about technology at SAS | found | digital, technology, network, Schoology, PowerSchool, Office 365 |
| 2 | Board policies for student travel? | found | field trip, excursion, activity travel, 7.807 |
| 3 | When was SAS founded? | found | 1912 |
| 4 | Board last expanded? | found | 2023, 2022, 2024, expanded, added, increased, new member |
| 5 | Board members - parents? | found | Association of Parents, elected, appointed, need not be, must be a member |
| 6 | Historical tuition? | found | RMB, ¥, tuition, increase, SY20 |
| 7 | School tuition? | found | RMB, ¥, tuition, Pre-K, Elementary, Middle, High, fee |
| 8 | What kind of school? | found | American, international, English, Pre-K, grade 12, K-12, non-profit, curriculum |
| 9 | Tuition compare to others? | found | Dulwich, Wellington, Harrow, Concordia, SCIS, Tier 1, #7, ranking, average |
| 10 | Other Tier 1 schools? | found | Dulwich, Wellington, Harrow, Concordia, SCIS, YCIS, BISS, WISS, NAIS |
| 11 | Trips count as absences? | found | not counted, not count, excused, will not be counted |
| 12 | Parents take students from trip? | found | yes, guardian, notify, instruction time |
| 13 | Puxi vs Pudong? | found | one school, East Campus, West Campus, aligned |
| 14 | Projects for 2024? | found | library, facility, capital, renovation, construction, budget, RMB |
| 15 | Current priorities? | found | education, strategic, facility, student, program, curriculum |
| 16 | Compare to benchmarks? | found | ISB, TAS, HKIS, SFS, Singapore, counselor, ratio, tuition, Tier 1, IB, AP |
| 17 | College admissions? | found | admission, university, college, acceptance, NYU, USC, Brown, Yale |
| 18 | Best fit? | found | best fit, college, counseling, individual, student, evidence-based |
| 19 | Strategic differentiation? | found | differentiation, strategic, curriculum, American, IB, AP, unique, positioning |
| 20 | Biggest challenges/opportunities? | found | challenge, opportunity, enrollment, facility, competition, growth |
| 21 | Shenzhen campus? | not_found | (should say doesn't exist) |
| 22 | When was SAS founded? (repeat) | found | 1912 |
| 23-46 | Chinese versions of Q1-22 + 2 extra | found/not_found | (same keywords in Chinese) |

## Report Output

Report saved to `docs/test-report-sas-board-{date}.md` with:
1. **Summary table** — all questions with pass/fail, time, and matched facts
2. **Failed questions detail** — full answer for each failed question
3. **All Q&A** — complete answers for reference
