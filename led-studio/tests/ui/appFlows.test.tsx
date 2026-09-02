import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { useProjectStore } from '../../src/stores/projectStore'
import { getMockApi } from './setup'

async function createProjectViaUi(user: ReturnType<typeof userEvent.setup>, name = '測試演出') {
  if (!screen.queryByRole('button', { name: '新建專案' })) {
    await user.click(sidebarLink('Dashboard'))
  }
  const newBtn = await screen.findByRole('button', { name: '新建專案' })
  await user.click(newBtn)
  const dialog = await screen.findByRole('heading', { name: '新建專案' })
  const panel = dialog.closest('.modal-panel')!
  const input = within(panel as HTMLElement).getByRole('textbox')
  await user.clear(input)
  await user.type(input, name)
  await user.click(within(panel as HTMLElement).getByRole('button', { name: '建立' }))
  await waitFor(() => expect(document.querySelector('.project-name')).toHaveTextContent(name))
}

function sidebarLink(name: string) {
  return within(screen.getByRole('navigation')).getByRole('link', { name })
}

function mockCanvasRect(canvas: HTMLCanvasElement) {
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      toJSON: () => ({})
    }) as DOMRect
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()
}

describe('LED Show Studio UI flows (simulated clicks)', () => {
  it('Dashboard: 新建專案 dialog → 4 dancers', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('開始編排')).toBeInTheDocument()

    await createProjectViaUi(user, 'E2E 演出')

    expect(screen.getByText('Roles: 4')).toBeInTheDocument()
    expect(useProjectStore.getState().project?.roles).toHaveLength(4)
    expect(screen.getByText(/已建立新專案/)).toBeInTheDocument()
  })

  it('Dashboard: 載入範例專案', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '載入範例專案' }))

    await waitFor(() => expect(mock.api.project.openDemo).toHaveBeenCalled())
    expect(screen.getByText(/已載入範例專案/)).toBeInTheDocument()
    expect(useProjectStore.getState().project?.roles.length).toBeGreaterThan(0)
  })

  it('Dashboard: 開啟 / 儲存專案', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)
    await createProjectViaUi(user)

    await user.click(screen.getByRole('button', { name: '開啟專案' }))
    expect(mock.api.project.openFile).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '儲存專案' }))
    expect(mock.api.project.saveFile).toHaveBeenCalled()
  })

  it('Dancers: 新增舞者與亮燈條件', async () => {
    const user = userEvent.setup()
    render(<App />)
    await createProjectViaUi(user)

    await user.click(sidebarLink('舞者 CRUD'))
    expect(screen.getByRole('heading', { name: '舞者 / 亮燈條件' })).toBeInTheDocument()

    const before = useProjectStore.getState().project!.roles.length
    await user.click(screen.getByRole('button', { name: '+ 舞者' }))
    expect(useProjectStore.getState().project!.roles).toHaveLength(before + 1)

    await user.click(screen.getByRole('button', { name: '+ 新增亮燈條件' }))
    expect(useProjectStore.getState().activeRole()?.events).toHaveLength(1)
  })

  it('Timeline: 匯入音檔、+ 事件、角色分頁', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)
    await createProjectViaUi(user)

    await user.click(sidebarLink('Timeline'))
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '匯入音檔' }))
    await waitFor(() => expect(mock.api.project.pickMusicFile).toHaveBeenCalled())
    await waitFor(() =>
      expect(useProjectStore.getState().project?.project.music_file).toBe('/tmp/test-track.mp3')
    )

    await user.click(screen.getByRole('button', { name: '+ Clip' }))
    expect(useProjectStore.getState().activeRole()?.events).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Clip 屬性' })).toBeInTheDocument()

    const tabs = screen.getAllByRole('button', { name: /舞者/ })
    if (tabs.length > 1) {
      await user.click(tabs[1])
      expect(useProjectStore.getState().activeRoleId).toBe(
        useProjectStore.getState().project!.roles[1].role_id
      )
    }
  })

  it('Timeline: canvas 拖曳建立事件（手軌道）不白屏', async () => {
    const user = userEvent.setup()
    render(<App />)
    await createProjectViaUi(user)
    await user.click(sidebarLink('Timeline'))

    const canvas = document.querySelector('canvas.timeline-canvas') as HTMLCanvasElement
    expect(canvas).toBeTruthy()
    mockCanvasRect(canvas)

    // hand track ~ y=120, drag from x=150 to x=350
    fireEvent.pointerDown(canvas, { clientX: 150, clientY: 120, pointerId: 1, buttons: 1 })
    fireEvent.pointerMove(canvas, { clientX: 350, clientY: 120, pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(canvas, { clientX: 350, clientY: 120, pointerId: 1 })

    await waitFor(() => {
      expect(useProjectStore.getState().activeRole()?.events.length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.queryByText(/頁面發生錯誤/)).not.toBeInTheDocument()
  })

  it('Timeline: 點波形區移動 playhead 不 crash', async () => {
    render(<App />)
    const user = userEvent.setup()
    await createProjectViaUi(user)
    await user.click(sidebarLink('Timeline'))

    const canvas = document.querySelector('canvas.timeline-canvas') as HTMLCanvasElement
    mockCanvasRect(canvas)

    fireEvent.pointerDown(canvas, { clientX: 200, clientY: 40, pointerId: 2, buttons: 1 })
    fireEvent.pointerUp(canvas, { clientX: 200, clientY: 40, pointerId: 2 })

    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument()
  })

  it('Timeline: 拉動粉紅色進度會啟動 Bridge 並控制 ESP 時間', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)
    await createProjectViaUi(user)
    await user.click(sidebarLink('Timeline'))

    const progress = document.querySelector('.transport-progress') as HTMLInputElement
    fireEvent.change(progress, { target: { value: '5000' } })

    await waitFor(() => expect(mock.api.show.bridgeStart).toHaveBeenCalledWith({ source: 'preview' }))
    await waitFor(() => expect(mock.api.show.bridgeSeek).toHaveBeenCalledWith(5000))
    expect(screen.getByRole('button', { name: 'LED 同步：開' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Devices: 掃描 port、Ping、上傳 config', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)
    await createProjectViaUi(user)

    await user.click(sidebarLink('Devices'))
    expect(screen.getByRole('heading', { name: 'Device Manager' })).toBeInTheDocument()

    await waitFor(() => expect(mock.api.device.listPorts).toHaveBeenCalled())

    const pingBtn = screen.getByRole('button', { name: 'Ping' })
    await waitFor(() => expect(pingBtn).not.toBeDisabled())
    await user.click(pingBtn)
    await waitFor(() => expect(mock.api.device.ping).toHaveBeenCalledWith('/dev/cu.usbserial-mock'))

    await user.type(screen.getByPlaceholderText('場地 Wi-Fi 或筆電熱點'), 'TestWiFi')
    await user.click(screen.getByRole('button', { name: '寫入 WiFi → NVS' }))
    await waitFor(() => expect(mock.api.device.setWifi).toHaveBeenCalled())

    const brightness = screen.getByRole('spinbutton', { name: '亮度百分比' })
    await user.clear(brightness)
    await user.type(brightness, '40')
    await user.click(screen.getByRole('button', { name: '上傳 Config (Serial)' }))
    await waitFor(() => expect(mock.api.device.uploadConfig).toHaveBeenCalledWith(
      '/dev/cu.usbserial-mock',
      expect.objectContaining({
        device: expect.objectContaining({ max_brightness: 0.4 })
      })
    ))
    expect(screen.getByText(/Ping ESP: OK/)).toBeInTheDocument()
  })

  it('Devices: 手動輸入 port 時按鈕可用', async () => {
    const user = userEvent.setup()
    getMockApi().api.device.listPorts = vi.fn(async () => [])
    render(<App />)
    await createProjectViaUi(user)
    await user.click(sidebarLink('Devices'))

    await waitFor(() => expect(screen.getByText(/未偵測到 Serial Port/)).toBeInTheDocument())

    const manual = screen.getByPlaceholderText('/dev/cu.usbserial-1100')
    await user.type(manual, '/dev/cu.manual')
    const pingBtn = screen.getByRole('button', { name: 'Ping' })
    expect(pingBtn).not.toBeDisabled()
  })

  it('音樂控制: 播放 / 停止 Bridge', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '載入範例專案' }))
    await waitFor(() => expect(useProjectStore.getState().project?.project.music_file).toBeTruthy())

    await user.click(sidebarLink('音樂控制'))
    expect(screen.getByRole('heading', { name: '音樂控制' })).toBeInTheDocument()

    const playBtn = screen.getByRole('button', { name: '播放' })
    await user.click(playBtn)
    await waitFor(() => expect(mock.api.show.bridgeStart).toHaveBeenCalledWith({ source: 'preview' }))

    mock.emitBridgeState({ running: true, musicTimeMs: 5000, sequence: 10, packetsPerSecond: 50, source: 'preview' })
    await waitFor(() => expect(screen.getByText('RUNNING')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '停止' }))
    expect(mock.api.show.bridgeStop).toHaveBeenCalled()
  })

  it('音樂控制: 頁面可達', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(sidebarLink('音樂控制'))
    expect(screen.getByLabelText('音樂播放控制')).toBeInTheDocument()
  })

  it('LED 串聯: 預設 6 通道可分頁編輯', async () => {
    const user = userEvent.setup()
    render(<App />)
    await createProjectViaUi(user)

    await user.click(sidebarLink('LED 串聯'))
    expect(screen.getByRole('heading', { name: 'LED 輸出與並聯配置' })).toBeInTheDocument()
    expect(screen.getByText('640')).toBeInTheDocument()
    expect(screen.getByText('800')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /通道 3右腳GPIO 6/ }))
    expect(screen.getByLabelText('每根手指／腳趾燈數')).toHaveValue(10)
    const role = useProjectStore.getState().activeRole()
    expect(role?.led_outputs).toHaveLength(6)
  })

  it('Global toolbar: 儲存專案按鈕各頁可見', async () => {
    const user = userEvent.setup()
    const mock = getMockApi()
    render(<App />)
    await createProjectViaUi(user)

    expect(screen.getByRole('button', { name: '儲存專案' })).toBeInTheDocument()

    await user.click(sidebarLink('Timeline'))
    await user.click(screen.getByRole('button', { name: '儲存專案' }))
    await waitFor(() => expect(mock.api.project.saveFile).toHaveBeenCalled())
  })

  it('導航：所有 sidebar 連結可達', async () => {
    const user = userEvent.setup()
    render(<App />)
    await createProjectViaUi(user)

    const links = ['Dashboard', '舞者 CRUD', 'Timeline', 'LED 串聯', 'Devices', '音樂控制'] as const
    for (const name of links) {
      await user.click(sidebarLink(name))
      expect(document.querySelector('.content')).toBeTruthy()
    }
  })
})
