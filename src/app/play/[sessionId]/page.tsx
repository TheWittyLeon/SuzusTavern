interface PlayPageProps {
  // Sync params for Jest compatibility — upgrade to Promise<{sessionId: string}> when async Server Components are testable
  params: { sessionId: string };
}

export default function PlayPage(_props: PlayPageProps) {
  return (
    <main>
      <h1>Play — coming soon</h1>
    </main>
  );
}
