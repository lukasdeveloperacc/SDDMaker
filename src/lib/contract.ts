// Backend·Frontend 공용 계약. 바꾸려면 리더 승인 필요.
export const AGENT_NAMES = ['claude', 'codex'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export type InterviewStatus = 'active' | 'summarized' | 'approved' | 'skipped';
export type DocStatus = 'empty' | 'draft' | 'approved';
export type MessageRole = 'agent' | 'user';
export type DocKind = 'base' | 'requirement' | 'screen' | 'change';
export type RunKind = 'interview' | 'document' | 'annotations';

export type AgentErrorCode = 'cli_not_found' | 'not_logged_in' | 'not_subscription' | 'login_failed' | 'agent_failed';
export type HttpErrorCode =
  | 'invalid_input'    // 400 요청 형식·값 오류, 잘못된 agent·문서 경로
  | 'script_rejected'  // 400 화면 정의서 저장 본문에 <script
  | 'forbidden_host'   // 403 Host/Origin 검사 실패
  | 'not_found'        // 404 프로젝트·문서 행 없음
  | 'busy'             // 409 프로젝트 실행 중(새 실행), 또는 그 문서가 실행 중(저장·되돌리기·승인·승인 취소)
  | 'login_running'    // 409 같은 CLI 로그인 진행 중
  | 'precondition'     // 409 생성·승인 조건 미충족
  | 'design_required'  // 409 디자인 문서 필요(화면 정의서 생성) 또는 화면 정의서가 있는데 디자인 문서 비우기
  | 'approved_locked'  // 409 approved 문서·화면 저장·생성·되돌리기·주석
  | 'invalid_state'    // 409 그 상태에서 할 수 없는 전이
  | 'nothing_to_undo'  // 409
  | 'invalid_links'    // 409 items = 규칙 위반 링크 이름 (0-PRODUCT 링크 없음 포함)
  | 'export_blocked';  // 409 items = 승인 안 됨·목록에서 빠짐 문서 경로
export interface ApiError { code: HttpErrorCode; message: string; items?: string[] }

export type Gate = { ok: true } | { ok: false; code: HttpErrorCode; reason: string; items?: string[] };

export interface Project { id: number; name: string; idea: string; designMd: string | null; createdAt: string }
export interface ProjectSummary {
  id: number; name: string; createdAt: string;
  interviewStatus: InterviewStatus | null;
  approvedCount: number; totalCount: number; // 둘 다 "목록에서 빠짐" 문서 제외
}
export interface InterviewMessage { id: number; role: MessageRole; content: string; createdAt: string }
export interface Interview {
  status: InterviewStatus; agent: AgentName | null; hasSession: boolean;
  summary: string | null; messages: InterviewMessage[];
}
export interface DocumentView {
  path: string;            // 'requirements/project.md'
  kind: DocKind;
  stage: number;           // 1..7 (documents.md 생성 순서)
  name: string;            // requirement·screen은 'project'/'home', 그 외는 path
  content: string;
  status: DocStatus;
  agent: AgentName | null;
  updatedAt: string;
  upstreamChanged: boolean;
  missingFromList: boolean;  // 저장하지 않고 계산
  canUndo: boolean;          // previous_content가 있음
  running: boolean;          // 이 문서가 지금 실행 중
  generate: Gate;
  approve: Gate;
  links: { names: string[]; invalid: string[] } | null; // 0-PRODUCT.md(requirements), 4-USERFLOW.md(screens)만, 현재 본문 기준
}
export interface ProjectDetail {
  project: Project;
  interview: Interview | null;
  documents: DocumentView[];   // stage 오름차순, 같은 stage는 path 오름차순
  running: { kind: RunKind; path: string | null } | null;
  exportGate: { ok: boolean; blocking: string[]; upstreamChanged: string[] };
}
export interface AgentStatus { installed: boolean; loggedIn: boolean; subscription: boolean; loginCommand: string; loginRunning?: boolean }
export type AgentsResponse = Record<AgentName, AgentStatus>;

export interface Box { x1: number; y1: number; x2: number; y2: number } // 0..1, iframe 문서 전체 대비
export type AnnotationTarget =
  | { component: string; tag: string; text: string }
  | { drawing: { box: Box; components: string[] } };
export interface Annotation { kind: 'change' | 'question'; target: AnnotationTarget; note: string }

export type RunEvent =
  | { event: 'delta'; data: { text: string } }
  | { event: 'done'; data: { text: string } }
  | { event: 'error'; data: { code: AgentErrorCode; message: string } };
export type LoginEvent =
  | { event: 'prompt'; data: { url: string; code?: string } }
  | { event: 'done'; data: { loggedIn: boolean } }
  | { event: 'error'; data: { code: 'login_failed' | 'cli_not_found'; message: string } };

export interface ProjectsResponse { projects: ProjectSummary[] }
export interface ProjectResponse { project: Project }
export interface InterviewResponse { interview: Interview }
export interface InterviewUnapproveResponse { interview: Interview; flagged: string[] }
export interface DocumentResponse { document: DocumentView }
export interface ApproveResponse { document: DocumentView; requirements?: string[]; screens?: string[] }
export interface UnapproveResponse { document: DocumentView; flagged: string[] }
export interface PromptPreviewResponse { prompt: string }

// 서버 내부 레코드 (DB 모듈이 camelCase로 돌려줌). Frontend는 쓰지 않는다.
export interface InterviewRecord {
  id: number; projectId: number; agent: AgentName | null; sessionId: string | null;
  summary: string | null; status: InterviewStatus;
}
export interface DocumentRecord {
  projectId: number; path: string; content: string; previousContent: string | null;
  status: DocStatus; upstreamChanged: boolean; agent: AgentName | null; updatedAt: string;
}

export const NAME_RE = /^[a-z0-9-]+$/;
export const BASE_DOCS = ['0-PRODUCT.md', '1-SYSTEM-ARCHITECTURE.md', '3-DATABASE.md', '4-USERFLOW.md'] as const;
export const CHANGE_DOC = 'changes/001-mvp.md';
export const DOC_PATH_RE =
  /^(0-PRODUCT\.md|1-SYSTEM-ARCHITECTURE\.md|3-DATABASE\.md|4-USERFLOW\.md|changes\/001-mvp\.md|requirements\/[a-z0-9-]+\.md|screens\/[a-z0-9-]+\.html)$/;
export function isAgentName(v: unknown): v is AgentName { return v === 'claude' || v === 'codex'; }
export function docApiPath(projectId: number, path: string, action?: string): string {
  return `/api/projects/${projectId}/documents/${encodeURIComponent(path)}${action ? `/${action}` : ''}`;
}
