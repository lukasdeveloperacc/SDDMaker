import { AgentConnections } from '@/components/AgentConnections';

export default function Page() {
  return (
    <section className="connections-page">
      <header className="connections-page-heading">
        <h1 className="h2">에이전트 연결</h1>
        <p className="caption">Claude·Codex 구독 계정과 GitHub 계정을 연결하세요.</p>
      </header>
      <AgentConnections />
    </section>
  );
}
