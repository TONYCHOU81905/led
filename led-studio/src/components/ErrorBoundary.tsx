import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  title?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="page">
          <h1>{this.props.title ?? '頁面發生錯誤'}</h1>
          <p className="error-banner">{this.state.error.message}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            重試
          </button>
        </section>
      )
    }
    return this.props.children
  }
}
