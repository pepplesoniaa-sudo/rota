export const metadata = {
  title: 'Rota API',
  description: 'Rota Shift Scheduling API',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
