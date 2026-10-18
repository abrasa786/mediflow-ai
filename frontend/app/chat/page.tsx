import MediflowChat, { type ChatStart } from "@/components/chat/MediflowChat";

const STARTS: ChatStart[] = ["book", "medicine", "report"];

// /chat?start=book | medicine | report jumps straight into that flow
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { start } = await searchParams;
  const flow = STARTS.find((s) => s === start);
  return (
    <div className="h-[100dvh] bg-slate-100">
      <div className="h-full max-w-3xl mx-auto shadow-sm">
        <MediflowChat variant="page" start={flow} />
      </div>
    </div>
  );
}
