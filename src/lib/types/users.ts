export type ManagedUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
};
