import { headers } from "next/headers";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import { MinnaApp } from "../minna-client";

export const dynamic = "force-dynamic";

export default async function HostPage() {
  const requestHeaders = await headers();
  const hostname = requestHeaders.get("host")?.split(":")[0] ?? "";
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const user = await getChatGPTUser();
  if (!local && !user) {
    return (
      <main className="signin-shell">
        <div className="wordmark">MINNA<span>.exe</span></div>
        <p className="eyebrow">HOST CONTROL</p>
        <h1>進行画面を開くには<br />ChatGPTでサインイン。</h1>
        <a className="signin-button" href={chatGPTSignInPath("/host")}>サインインして続ける</a>
      </main>
    );
  }
  return <MinnaApp mode="host" />;
}
