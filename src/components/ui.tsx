import { useEffect, useId, useRef } from 'react';
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';

// 반환 타입은 적지 않는다 (전역 JSX 네임스페이스를 쓰지 않음).

function cx(...names: (string | false | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'utility' }) {
  return <button className={cx('btn', `btn-${variant}`, className)} {...rest} />;
}

export function TextInput({
  label,
  error,
  id,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        className={className}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  label,
  error,
  id,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const errorId = `${areaId}-error`;
  return (
    <div className="field">
      <label htmlFor={areaId}>{label}</label>
      <textarea
        id={areaId}
        className={className}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('card', className)}>{children}</div>;
}

export function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'warn' | 'info';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const NOTICE_LABEL = { info: '안내', warn: '주의', error: '오류' } as const;

// 색 점만으로 구분하지 않도록 제목이 없으면 기본 라벨을 붙인다.
export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'error';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <strong className="notice-title">{title ?? NOTICE_LABEL[tone]}</strong>
      {children}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  wide,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Esc 등 브라우저가 닫은 경우도 onClose로 알린다.
  return (
    <dialog ref={ref} className={cx('modal', wide && 'modal-wide')} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId} className="title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
