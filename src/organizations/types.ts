export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreateOrganizationBody {
  name: string;
  slug?: string;
}
