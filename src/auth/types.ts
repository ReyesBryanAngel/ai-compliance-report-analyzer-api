export interface RegisterBody {
  email: string;
  password: string;
  name?: string;
  organizationId?: string;
  organizationName?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    organizationId: string | null;
  };
}
