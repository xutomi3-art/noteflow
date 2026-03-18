# Add E2E Test

Bug 修复或新功能实现后，将其加入 E2E 测试套件。

## 输入

用户描述 bug/功能，格式不限，例如：
- "分享链接过期后点击没有报错提示，已经修了"
- "新增了批量删除笔记本功能"
- 也可以不带描述，从当前对话上下文中提取

## 执行流程

### 1. 确定测试内容

从用户描述或对话上下文中提取：
- **场景**：什么操作/功能
- **预期行为**：修复后/实现后应该怎样
- **关键断言**：需要验证什么

### 2. 查看现有测试结构

读取现有测试文件，确定新测试放在哪个套件：

| 文件 | 范围 |
|------|------|
| `e2e/tests/01-auth.spec.ts` | 注册、登录、密码、SSO |
| `e2e/tests/02-dashboard.spec.ts` | 仪表盘、创建/删除笔记本 |
| `e2e/tests/03-notebook.spec.ts` | 笔记本页面三栏布局 |
| `e2e/tests/04-chat.spec.ts` | AI 聊天、消息、输入框 |
| `e2e/tests/05-studio.spec.ts` | Summary/FAQ/Mind Map/Action Items/Notes |
| `e2e/tests/06-sharing.spec.ts` | 分享、邀请链接、成员管理 |
| `e2e/tests/07-upload.spec.ts` | 文件上传、Add sources 模态框 |
| `e2e/tests/08-navigation.spec.ts` | 公共页面路由、重定向 |

如果不属于以上任何套件，创建新的 `e2e/tests/09-xxx.spec.ts`。

### 3. 编写测试

**选择器规则**（基于实际 DOM，不要猜）：
- Dashboard: `button "Create New"` → hover 出下拉 → `button "Personal Notebook"`
- Notebook 页: `heading "Sources"`, `heading "Chat"`, `heading "Studio"` (用 `exact: true` 避免和笔记本名冲突)
- Chat 输入框: `getByPlaceholder(/start typing/i)` (有 sources 时) 或 `getByPlaceholder(/upload sources/i)` (空笔记本)
- 上传: 先点 `button "Add sources"` 打开模态框，里面才有 `input[type="file"]`
- 分享: `button "Share with Team"` → 模态框有 `heading "Invite your team members"`
- Studio 按钮: `button "Summary"`, `button "FAQ"`, `button "Mind Map"`, `button "Action Items"`
- 头像/登出: `button "T"` (首字母) → `button "Log out"`
- 返回 Dashboard: `button "Noteflow"` (notebook 页 header)

**测试模板**：
```typescript
test('描述性名称', async ({ page }) => {
  // Arrange — 准备状态
  // Act — 执行操作
  // Assert — 验证结果
  await expect(page.locator('...')).toBeVisible({ timeout: 10000 });
});
```

### 4. 运行验证

```bash
npx playwright test e2e/tests/<对应文件> --reporter=line
```

确认新测试通过，且不影响其他测试。

### 5. 更新 test-cases.md

在 `.claude/skills/noteflow-e2e-test/references/test-cases.md` 追加测试用例记录：

```markdown
### TC-XXX: 简短描述
- **Bug/Feature:** 一句话说明
- **Steps:** 测试步骤
- **Expected:** 预期结果
```

### 6. 提交

```bash
git add e2e/tests/ .claude/skills/noteflow-e2e-test/references/test-cases.md
git commit -m "test: add E2E for <描述>"
```

## 关键原则

- **先用 Playwright snapshot 看实际 DOM**，不要猜选择器
- 每个 `beforeEach` 必须 `await expect(page.getByRole('heading', { name: /sources/i })).toBeVisible({ timeout: 15000 })` 等待页面加载
- 测试用新注册的用户，`afterAll` 清理创建的笔记本
- 测线上 `https://noteflow.jotoai.com`，不需要本地 Docker
