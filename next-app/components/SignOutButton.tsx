'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

export default function SignOutButton() {
  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <button
      onClick={handleSignOut}
      className="flex items-center gap-2 px-4 py-2 bg-f1-red hover:bg-red-700 text-white font-semibold rounded transition"
    >
      <LogOut size={16} />
      <span>Sign Out</span>
    </button>
  );
}
