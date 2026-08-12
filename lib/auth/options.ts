import { prisma } from "@/lib/db/client";
import Credentials from "@auth/core/providers/credentials";
import type { AuthConfig } from "@auth/core";
import argon2 from "argon2";

export const authOptions: AuthConfig = {
  basePath: "/api/auth",
  trustHost: true,
  providers: [
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.toString();
        const password = credentials?.password?.toString();

        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        // A disabled account is treated exactly like a nonexistent one — no
        // oracle revealing that the email is valid but deactivated.
        if (!user || user.disabledAt) {
          return null;
        }

        const isValid = await argon2.verify(user.passwordHash, password);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.id as string,
          role: token.role as string,
        },
      };
    },
    async jwt({ token, user }) {
      if (user) {
        return {
          ...token,
          role: (user as any).role,
          id: (user as any).id,
        };
      }
      return token;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
