import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth-config';
import { redirect } from 'next/navigation';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(getAuthOptions());
  
  // Redirect to dashboard if already logged in
  if (session) {
    redirect('/dashboard');
  }

  return children;
}
