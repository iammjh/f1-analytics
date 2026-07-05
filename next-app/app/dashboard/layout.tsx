import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth-config';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(getAuthOptions());
  if (!session) {
    redirect('/auth/signin');
  }

  return (
    <main className="w-full bg-f1-black">
      {children}
    </main>
  );
}
