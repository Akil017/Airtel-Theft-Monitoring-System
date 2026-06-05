import "./globals.css";

export const metadata = {
  title: "Airtel NOC — Theft Monitoring",
  description: "Real-time BTS site intrusion alarm dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
