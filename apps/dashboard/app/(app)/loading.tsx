export default function LoadingDesk() {
  return (
    <div className="panel" aria-busy="true" aria-live="polite">
      <h2>Connecting to the live desk</h2>
      <div className="skeleton-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="muted">Loading TxLINE feed state and decision evidence…</p>
    </div>
  );
}
