import httpx, json, sys, time, re

TOKEN = sys.argv[1]
BASE = "http://localhost:8000"
NB = "12d065c7-9c67-4125-b39d-75185e063e09"

QUESTIONS = [
    {"q": "Tell me about technology at SAS", "type": "found", "expect": ["digital", "technology", "network", "Schoology", "PowerSchool", "Office 365"]},
    {"q": "Are there any Board policies for student travel?", "type": "found", "expect": ["field trip", "excursion", "activity travel", "7.807"]},
    {"q": "When was SAS founded?", "type": "found", "expect": ["1912"]},
    {"q": "When was the Board last expanded?", "type": "found", "expect": ["2023", "2022", "2024", "expanded", "added", "increased", "new member"]},
    {"q": "Tell me what the policy says about Board members. Do they have to be parents?", "type": "found", "expect": ["Association of Parents", "elected", "appointed", "need not be", "must be a member"]},
    {"q": "Can you tell me anything about historical tuition?", "type": "found", "expect": ["RMB", "¥", "tuition", "increase", "SY20"]},
    {"q": "What can you tell me about school tuition?", "type": "found", "expect": ["RMB", "¥", "tuition", "Pre-K", "Elementary", "Middle", "High", "fee"]},
    {"q": "What kind of school is SAS?", "type": "found", "expect": ["American", "international", "English", "Pre-K", "grade 12", "K-12", "non-profit", "curriculum"]},
    {"q": "How does SAS tuition compare to other schools in the Shanghai market?", "type": "found", "expect": ["Dulwich", "Wellington", "Harrow", "Concordia", "SCIS", "Tier 1", "#7", "ranking", "average"]},
    {"q": "Who are the other Tier 1 international schools in Shanghai?", "type": "found", "expect": ["Dulwich", "Wellington", "Harrow", "Concordia", "SCIS", "YCIS", "BISS", "WISS", "NAIS"]},
    {"q": "Do school trips count as school absences?", "type": "found", "expect": ["not counted", "not count", "excused", "will not be counted"]},
    {"q": "Can parents or guardians take students home directly from a field trip site?", "type": "found", "expect": ["yes", "guardian", "notify", "instruction time"]},
    {"q": "How does SAS differentiate the two campuses Puxi and Pudong?", "type": "found", "expect": ["one school", "East Campus", "West Campus", "aligned"]},
    {"q": "What projects were scheduled for 2024?", "type": "found", "expect": ["library", "facility", "capital", "renovation", "construction", "budget", "RMB"]},
    {"q": "What are the current school priorities?", "type": "found", "expect": ["education", "strategic", "facility", "student", "program", "curriculum"]},
    {"q": "How does SAS compare to its benchmark schools?", "type": "found", "expect": ["ISB", "TAS", "HKIS", "SFS", "Singapore", "counselor", "ratio", "tuition", "Tier 1", "curriculum", "IB", "AP"]},
    {"q": "What about college admissions?", "type": "found", "expect": ["admission", "university", "college", "acceptance", "admit rate", "NYU", "USC", "Brown", "Yale", "application"]},
    {"q": "Tell me about best fit", "type": "found", "expect": ["best fit", "college", "counseling", "individual", "student", "evidence-based"]},
    {"q": "Tell me about strategic differentiation", "type": "found", "expect": ["differentiation", "strategic", "curriculum", "American", "IB", "AP", "unique", "positioning"]},
    {"q": "What are the school's biggest challenges? Biggest opportunities?", "type": "found", "expect": ["challenge", "opportunity", "enrollment", "facility", "competition", "growth", "changing world"]},
    {"q": "Tell me more about SAS's Shenzhen campus", "type": "not_found", "expect": []},
    {"q": "When was SAS founded?", "type": "found", "expect": ["1912"]},
    {"q": "介绍一下上海美国学校的技术相关情况", "type": "found", "expect": ["技术", "数字", "网络", "Schoology", "PowerSchool", "Office 365", "technology"]},
    {"q": "学校是否有针对学生出行的董事会政策", "type": "found", "expect": ["出行", "旅行", "实地考察", "field trip", "excursion", "研学", "7.807"]},
    {"q": "上海美国学校成立于哪一年", "type": "found", "expect": ["1912"]},
    {"q": "学校董事会最近一次扩充人员是在什么时候", "type": "found", "expect": ["2023", "2022", "2024", "扩充", "任命", "选举", "增加"]},
    {"q": "请说明学校关于董事会成员的相关政策规定 成员必须是学生家长吗", "type": "found", "expect": ["家长", "协会成员", "当选", "任命", "parent", "Association", "elected", "appointed"]},
    {"q": "你能介绍一下学校过往的学费情况吗", "type": "found", "expect": ["学费", "tuition", "RMB", "¥", "增长", "涨幅", "历年", "SY20"]},
    {"q": "关于学校学费你能提供哪些信息", "type": "found", "expect": ["学费", "tuition", "RMB", "¥", "幼儿园", "小学", "中学", "高中", "Pre-K"]},
    {"q": "上海美国学校是一所什么类型的学校", "type": "found", "expect": ["美式", "国际", "英语", "K-12", "非营利", "American", "international", "课程"]},
    {"q": "上海美国学校的学费与上海市场上的其他学校相比如何", "type": "found", "expect": ["Dulwich", "Wellington", "排名", "Tier 1", "一线", "平均", "ranking", "对比"]},
    {"q": "上海还有哪些其他的一线国际学校", "type": "found", "expect": ["Dulwich", "Wellington", "Harrow", "Concordia", "SCIS", "德威", "惠灵顿"]},
    {"q": "学校组织的外出研学活动会算作学生缺勤吗", "type": "found", "expect": ["不计入", "不算", "not count", "excused", "缺勤记录", "不会"]},
    {"q": "家长或监护人可以直接从研学活动地点接学生回家吗", "type": "found", "expect": ["可以", "通知", "教学时间", "notify", "条件"]},
    {"q": "上海美国学校的浦西校区和浦东校区有哪些区别", "type": "found", "expect": ["浦西", "浦东", "一所学校", "两个校区", "统一", "一致", "东校区", "西校区"]},
    {"q": "学校2024年规划了哪些项目", "type": "found", "expect": ["图书馆", "设施", "资本", "翻新", "项目", "预算", "library", "facility", "RMB"]},
    {"q": "学校当前的工作重点是什么", "type": "found", "expect": ["教育", "战略", "设施", "学生", "课程", "发展", "重点"]},
    {"q": "上海美国学校与其对标学校相比表现如何", "type": "found", "expect": ["ISB", "TAS", "HKIS", "对标", "比较", "学费", "counselor", "排名", "benchmark", "Tier"]},
    {"q": "大学录取情况如何", "type": "found", "expect": ["录取", "大学", "申请", "admission", "NYU", "USC", "Brown", "Yale", "录取率", "application"]},
    {"q": "谈谈最佳适配的相关理念", "type": "found", "expect": ["最佳适配", "best fit", "大学", "升学", "college", "匹配", "个人"]},
    {"q": "谈谈学校的战略差异化发展", "type": "found", "expect": ["差异化", "战略", "课程", "美式", "IB", "AP", "differentiation", "定位"]},
    {"q": "学校目前面临的最大挑战是什么 最大机遇又是什么", "type": "found", "expect": ["挑战", "机遇", "招生", "设施", "竞争", "发展", "challenge", "opportunity"]},
    {"q": "详细介绍一下上海美国学校的深圳校区", "type": "not_found", "expect": []},
    {"q": "上海美国学校成立于哪一年", "type": "found", "expect": ["1912"]},
    {"q": "作为理事会成员可以做多久", "type": "found", "expect": ["两年", "2年", "two year", "延长", "extend", "任期", "term", "4年", "four year"]},
    {"q": "作为董事会成员可以做多久", "type": "found", "expect": ["两年", "2年", "two year", "延长", "extend", "任期", "term", "4年", "four year"]},
]

NOT_FOUND_PHRASES = [
    "no information", "no specific", "not found", "do not contain",
    "does not contain", "does not have", "no relevant", "cannot find",
    "not available", "not mentioned", "no mention", "no data",
    "没有提到", "未提及", "没有找到", "无法找到", "没有相关",
    "文档中没有", "不包含", "没有包含", "无法确定", "没有记录", "不存在",
]

def clear_history():
    try:
        httpx.delete(f"{BASE}/api/notebooks/{NB}/chat/history",
                     headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10)
    except:
        pass

def ask(question):
    answer = ""
    try:
        with httpx.Client(timeout=180) as c:
            with c.stream("POST", f"{BASE}/api/notebooks/{NB}/chat",
                         json={"message": question},
                         headers={"Authorization": f"Bearer {TOKEN}"}) as resp:
                for line in resp.iter_lines():
                    if line.startswith("data: "):
                        try:
                            d = json.loads(line[6:])
                            if d.get("type") == "token":
                                answer += d.get("content", "")
                        except:
                            pass
    except Exception as e:
        answer = f"ERROR: {e}"
    return answer.strip()

def evaluate(answer, q_data):
    et = q_data["type"]
    expected = q_data["expect"]
    answer_lower = answer.lower()
    first250 = answer_lower[:250]

    has_not_found = any(p in first250 for p in NOT_FOUND_PHRASES)

    if et == "not_found":
        return has_not_found or len(answer) < 50, []

    matched = [kw for kw in expected if kw.lower() in answer_lower]
    passed = len(matched) > 0 and not has_not_found
    return passed, matched

# Main
clear_history()
results = []
total = len(QUESTIONS)

for i, qd in enumerate(QUESTIONS):
    q = qd["q"]
    sys.stderr.write(f"  [{i+1}/{total}] {q[:50]}...\n")
    sys.stderr.flush()
    clear_history()
    t0 = time.time()
    answer = ask(q)
    elapsed = round(time.time() - t0, 1)
    passed, matched = evaluate(answer, qd)
    results.append({
        "idx": i+1, "q": q, "type": qd["type"],
        "expect": qd["expect"], "matched": matched,
        "passed": passed, "time": elapsed,
        "answer": answer[:2000],
    })
    status = "PASS" if passed else "FAIL"
    sys.stderr.write(f"    -> {status} ({elapsed}s) matched={matched}\n")
    sys.stderr.flush()

clear_history()

# Generate report
pass_count = sum(1 for r in results if r["passed"])
fail_count = total - pass_count
date = time.strftime("%Y-%m-%d")

print(f"# SAS Board Knowledge Base Test Report — {date}\n")
print(f"**Environment**: Testing (10.200.0.112)")
print(f"**Notebook**: Board Meeting")
print(f"**Total**: {total} | **Pass**: {pass_count} | **Fail**: {fail_count} | **Rate**: {pass_count/total*100:.0f}%\n")

print("## Summary\n")
print("| # | Question | Status | Time | Matched Keywords |")
print("|---|---------|--------|------|-----------------|")
for r in results:
    s = "✅" if r["passed"] else "❌"
    matched_str = ", ".join(r["matched"][:5]) if r["matched"] else ("(not_found OK)" if r["passed"] else "NONE")
    print(f"| {r['idx']} | {r['q'][:60]} | {s} | {r['time']}s | {matched_str} |")

if fail_count > 0:
    print(f"\n## Failed Questions ({fail_count})\n")
    for r in results:
        if not r["passed"]:
            print(f"### Q{r['idx']}. {r['q']}\n")
            print(f"**Expected keywords**: {', '.join(r['expect'])}")
            print(f"**Matched**: {', '.join(r['matched']) if r['matched'] else 'NONE'}")
            print(f"**Answer preview**: {r['answer'][:500]}\n")
            print("---\n")

print(f"\n## All Questions & Answers\n")
for r in results:
    s = "✅ PASS" if r["passed"] else "❌ FAIL"
    print(f"### Q{r['idx']}. {r['q']}\n")
    print(f"**Status**: {s} | **Time**: {r['time']}s | **Matched**: {', '.join(r['matched']) if r['matched'] else 'NONE'}\n")
    print(f"{r['answer']}\n")
    print("---\n")
