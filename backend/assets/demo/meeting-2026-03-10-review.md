# Project Budget Planning — Review Meeting

**Date:** March 10, 2026
**Attendees:** Sarah Chen (VP Engineering), Kevin Liu (Finance Director), Lisa Wang (Product Lead), Tony Zhang (CTO), Rachel Kim (HR Director)
**Location:** Conference Room A / Zoom

---

## Agenda
1. Review action items from kickoff
2. AI infrastructure deep dive
3. Headcount timeline and costs
4. Product roadmap budget alignment
5. Risk assessment

---

## 1. Action Item Review

| Item | Owner | Status |
|------|-------|--------|
| AI infrastructure cost breakdown | Tony | Complete |
| Headcount plan with HR | Sarah/Rachel | Complete |
| Vendor contract review | Kevin | In Progress |
| Product roadmap alignment | Lisa | Complete |
| Datadog alternatives evaluation | Tony | Complete |

## 2. AI Infrastructure Deep Dive

Tony presented detailed monthly projections:

### LLM API Costs (Monthly)
| Service | Current Usage | Projected Growth | Monthly Cost |
|---------|-------------|-----------------|-------------|
| DeepSeek V3 (Chat) | 50M tokens | +20%/quarter | $8,500 |
| DeepSeek R1 (Reasoning) | 10M tokens | +40%/quarter | $3,200 |
| Qwen Embedding | 100M tokens | +15%/quarter | $1,800 |
| Qwen Vision (OCR) | 5M tokens | Stable | $1,500 |
| **Total** | | | **$15,000** |

### Infrastructure Costs (Monthly)
| Component | Specification | Monthly Cost |
|-----------|-------------|-------------|
| GPU Server (A100 x2) | Fine-tuning + inference | $6,400 |
| Elasticsearch Cluster | 3 nodes, 500GB | $1,800 |
| PostgreSQL (RDS) | db.r6g.xlarge | $800 |
| Redis Cache | 16GB | $200 |
| MinerU (Document Parsing) | 4 CPU instances | $1,200 |
| CDN + Storage | S3 + CloudFront | $600 |
| **Total** | | **$11,000** |

**Annual projection: $312,000** (within the proposed $318K budget)

Kevin approved the AI budget with a recommendation to negotiate volume discounts with DeepSeek.

## 3. Headcount Timeline

Rachel presented the hiring plan:

| Role | Target Start | Salary Range | Status |
|------|-------------|-------------|--------|
| Senior ML Engineer #1 | April 15 | $170-190K | 3 candidates in pipeline |
| Senior ML Engineer #2 | May 1 | $170-190K | Sourcing |
| DevOps/SRE | June 1 | $140-160K | Job posting live |
| Frontend Engineer | June 15 | $130-150K | Job posting live |

**Risk:** ML engineer hiring is competitive. Recommend offering signing bonuses ($15-25K) to close faster.

Total FY2026 personnel addition: **$680K** (revised up from $650K due to signing bonuses)

## 4. Product Roadmap Budget Alignment

Lisa mapped product priorities to budget:

### Q1-Q2 Priorities (High Investment)
1. **AI Knowledge Base v2** — RAG improvements, multi-modal support → $120K
2. **Enterprise Features** — SSO, admin panel, audit logs → $80K
3. **Mobile Responsive** — Full mobile experience → $40K

### Q3-Q4 Priorities (Moderate Investment)
4. **Analytics Dashboard** — Usage metrics, ROI tracking → $60K
5. **API Platform** — Public API for integrations → $50K
6. **International** — Multi-language support, i18n → $35K

**Total product development investment: $385K** (engineering time allocated from existing headcount)

## 5. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| LLM API price increase | Medium | $50-100K | Multi-provider strategy, negotiate contracts |
| Hiring delays (ML) | High | 2-3 month delay | Signing bonuses, contractor bridge |
| Cloud cost overrun | Low | $30-50K | Auto-scaling limits, reserved instances |
| Competitor feature pressure | Medium | Scope creep | Strict prioritization framework |
| Currency fluctuation (CNY/USD) | Low | $20-30K | Hedge with quarterly contracts |

## Action Items

| Owner | Task | Due Date |
|-------|------|----------|
| Kevin | Negotiate DeepSeek volume discount | Mar 17 |
| Rachel | Extend offers to ML engineer candidates | Mar 14 |
| Sarah | Finalize FY2026 budget proposal for board | Mar 17 |
| Lisa | Create quarterly OKR alignment document | Mar 14 |
| Tony | Set up cost monitoring dashboards | Mar 17 |

**Next Meeting:** March 17, 2026 (Final budget approval)
