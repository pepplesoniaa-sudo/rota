interface InvitePageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function InviteLandingPage({ params }: InvitePageProps) {
  const { token } = await params;
  const deepLink = `rota://invite/${encodeURIComponent(token)}`;

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '40px auto', padding: 20 }}>
      <h1>You have been invited to join Rota</h1>
      <p>Shift scheduling for modern healthcare and hospitality teams.</p>
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <a
          href={deepLink}
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#006878',
            color: '#ffffff',
            textDecoration: 'none',
            borderRadius: 6,
            fontWeight: 'bold',
          }}
        >
          Open in Rota App
        </a>
      </div>
      <p style={{ color: '#555', fontSize: 14 }}>
        If the app does not open automatically, install the Rota development build on your device,
        then tap the button above or copy your invite link.
      </p>
    </main>
  );
}
