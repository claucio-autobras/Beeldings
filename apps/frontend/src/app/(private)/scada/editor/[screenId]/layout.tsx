// The private layout's <main> has overflow-y-auto and p-4/p-6 padding.
// The editor needs full height without that padding or overflow.
// We use -m-4 md:-m-6 to cancel the padding applied by the parent <main>.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-4 md:-m-6 h-[calc(100vh-3.5rem)] overflow-hidden">
      {children}
    </div>
  );
}
