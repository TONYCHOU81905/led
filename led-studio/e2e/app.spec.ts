import { test, expect, createProject, nav } from './fixtures'

test.describe('LED Show Studio E2E (real Electron)', () => {
  test('Dashboard: 新建專案 dialog', async ({ window }) => {
    await expect(window.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(window.getByText('開始編排')).toBeVisible()
    await createProject(window, 'E2E 新建測試')
    await expect(window.getByText('Roles: 4')).toBeVisible()
    await expect(window.getByText(/已建立新專案/)).toBeVisible()
  })

  test('Dashboard: 載入範例專案', async ({ window }) => {
    await window.getByRole('button', { name: '載入範例專案' }).click()
    await expect(window.getByText(/已載入範例專案/)).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText(/Roles:/)).toBeVisible()
  })

  test('Dancers: tab 切換與新增亮燈條件', async ({ window }) => {
    await createProject(window)
    await nav(window, '舞者 CRUD')
    await expect(window.getByRole('heading', { name: '舞者 / 亮燈條件' })).toBeVisible()
    await expect(window.getByRole('button', { name: '舞者 A' })).toBeVisible()
    await window.getByRole('button', { name: '+ 新增亮燈條件' }).click()
    await expect(window.locator('.event-table tbody tr')).toHaveCount(1)
  })

  test('Timeline: + 事件與匯入音檔按鈕', async ({ window }) => {
    await createProject(window)
    await nav(window, 'Timeline')
    await expect(window.getByRole('heading', { name: 'Timeline' })).toBeVisible()
    await window.getByRole('button', { name: '+ Clip' }).click()
    await expect(window.locator('canvas.timeline-canvas')).toBeVisible()
    await expect(window.getByRole('button', { name: '匯入音檔' })).toBeEnabled()
  })

  test('Timeline: canvas 拖曳不白屏', async ({ window }) => {
    await createProject(window)
    await nav(window, 'Timeline')
    const canvas = window.locator('canvas.timeline-canvas')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    // hand track area — drag to create event
    const x1 = (box!.x ?? 0) + 150
    const y = (box!.y ?? 0) + 120
    await window.mouse.move(x1, y)
    await window.mouse.down()
    await window.mouse.move(x1 + 200, y)
    await window.mouse.up()
    await expect(window.getByRole('heading', { name: 'Timeline' })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Clip 屬性' })).toBeVisible({ timeout: 5_000 })
  })

  test('Devices: 頁面載入與 port 掃描', async ({ window }) => {
    await createProject(window)
    await nav(window, 'Devices')
    await expect(window.getByRole('heading', { name: 'Device Manager' })).toBeVisible()
    await window.getByRole('button', { name: '重新掃描' }).click()
    // Either ports found or error banner — page must stay usable
    await expect(window.getByRole('button', { name: 'Ping' })).toBeVisible()
    const manual = window.getByPlaceholder('/dev/cu.usbserial-1100')
    await manual.fill('/dev/cu.e2e-manual')
    await expect(window.getByRole('button', { name: 'Ping' })).toBeEnabled()
  })

  test('Show Control: Bridge 啟停與 Pause', async ({ window }) => {
    await nav(window, 'Show Control')
    await expect(window.getByRole('heading', { name: 'Show Control' })).toBeVisible()
    const start = window.getByRole('button', { name: 'Start Bridge' })
    await start.click()
    await expect(window.getByText('RUNNING')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('button', { name: 'Pause' }).click()
    await expect(window.getByText('PAUSED')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('button', { name: 'Stop Bridge' }).click()
    await expect(window.getByText('STOPPED')).toBeVisible({ timeout: 10_000 })
  })

  test('Calibration 頁面可達', async ({ window }) => {
    await nav(window, '測試 / 校正')
    await expect(window.getByRole('heading', { name: '測試 / 校正' })).toBeVisible()
    await expect(window.getByText('同步驗收目標 ±10 ms')).toBeVisible()
  })

  test('Sidebar 導航全頁可達', async ({ window }) => {
    await createProject(window)
    const pages = ['Dashboard', '舞者 CRUD', 'Timeline', 'LED 串聯', 'Devices', 'Show Control', '測試 / 校正'] as const
    for (const p of pages) {
      await nav(window, p)
      await expect(window.locator('main.content')).toBeVisible()
    }
  })
})
