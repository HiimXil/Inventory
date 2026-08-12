import { AlertTriangleIcon } from "./icons";

export type ErrorStateProps = {
  /**
   * Deliberately a plain string, not an `error: Error` prop: this component
   * cannot render a stack trace or a technical message even by accident.
   * Whoever calls it is responsible for translating the failure into one
   * clear French sentence first (see the interface's "voice" rule — never
   * a technical trace in front of a technician in a van).
   */
  message: string;
};

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-control border-2 border-danger bg-danger/10 px-4 py-3">
      <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger-text" />
      <p className="text-base font-medium text-danger-text">{message}</p>
    </div>
  );
}
