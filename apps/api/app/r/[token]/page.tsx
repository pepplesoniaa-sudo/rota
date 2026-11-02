interface ResetPageProps {
  params: Promise<{
    token: string;
  }>;
}

export default async function PasswordResetLandingPage({ params }: ResetPageProps) {
  const { token } = await params;
  const deepLink = `rota://reset/${encodeURIComponent(token)}`;

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '40px auto', padding: 20 }}>
      <h1>Reset your Rota password</h1>
      <p>Tap below to reset your password securely inside the Rota app.</p>
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
          Reset Password in Rota App
        </a>
      </div>
      <p style={{ color: '#555', fontSize: 14 }}>
        This reset link is single-use and expires in 30 minutes. If you did not request this, you
        can safely ignore this page.
      </p>
    </main>
  );
}
