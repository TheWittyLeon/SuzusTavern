interface CharacterPageProps {
  // Sync params for Jest compatibility — upgrade to Promise<{id: string}> when async Server Components are testable
  params: { id: string };
}

export default function CharacterPage(_props: CharacterPageProps) {
  return (
    <main>
      <h1>Character — coming soon</h1>
    </main>
  );
}
