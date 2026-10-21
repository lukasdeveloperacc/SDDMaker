import { AgentConnections } from '@/components/AgentConnections';

export default function Page() {
  return (
    <section className="connections-page">
      <header className="connections-page-heading">
        <h1 className="h2">연결</h1>
        <p className="caption">문서 생성에 쓸 AI 에이전트와 GitHub 계정을 연결하세요.</p>
      </header>
      <AgentConnections />
    </section>
  );
}
