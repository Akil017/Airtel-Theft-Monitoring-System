import "./globals.css";

export const metadata = {
  title: "Airtel BTS — Theft Monitoring",
  description: "NOC Dashboard for BTS site intrusion alarms",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
