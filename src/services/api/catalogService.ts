/**
 * catalogService.ts
 * Conectado al backend real (category-controller).
 * Endpoints disponibles: /categories, /categories/{id}, /categories/{id}/activate.
 *
 * La OpenAPI actual documenta los IDs como parámetros de path.
 */
import { ICategory } from '../../types';
import { client } from './client';

// Shape real que devuelve el backend (CategoryRequest + id/active)
interface CategoryDto {
  id?: number;
  name: string;
  parentCategoryId?: number | null;
  active?: boolean;
}

// Mapea CategoryDto (backend) -> ICategory (frontend)
function toICategory(dto: CategoryDto): ICategory {
  return {
    id: String(dto.id),
    name: dto.name,
    parentCategoryId:
      dto.parentCategoryId !== null && dto.parentCategoryId !== undefined
        ? String(dto.parentCategoryId)
        : undefined,
    active: dto.active,
  };
}

// Mapea ICategory (frontend) -> CategoryRequest (backend)
function toCategoryRequest(data: Partial<ICategory>): Partial<CategoryDto> {
  return {
    name: data.name,
    parentCategoryId: data.parentCategoryId ? Number(data.parentCategoryId) : null,
  };
}

export const catalogService = {
  /** GET /categories */
  async getCategories(): Promise<ICategory[]> {
    const response = await client.get<CategoryDto[]>('/categories');
    return response.data.map(toICategory);
  },

  /** GET /categories/{id} */
  async getCategoryById(id: string): Promise<ICategory> {
    const response = await client.get<CategoryDto>(`/categories/${id}`);
    return toICategory(response.data);
  },

  /** POST /categories */
  async createCategory(dto: Partial<ICategory>): Promise<ICategory> {
    const response = await client.post<CategoryDto>('/categories', toCategoryRequest(dto));
    return toICategory(response.data);
  },

  /** PUT /categories/{id} */
  async updateCategory(id: string, dto: Partial<ICategory>): Promise<ICategory> {
    const response = await client.put<CategoryDto>(`/categories/${id}`, toCategoryRequest(dto));
    return toICategory(response.data);
  },

  /** DELETE /categories/{id} — baja lógica según el backend. */
  async deleteCategory(id: string): Promise<void> {
    await client.delete(`/categories/${id}`);
  },

  /** DELETE /categories/{id} — baja lógica según el backend. */
  async deactivateCategory(id: string): Promise<void> {
    await client.delete(`/categories/${id}`);
  },

  /** PATCH /categories/{id}/activate — reactiva una categoría dada de baja lógica. */
  async activateCategory(id: string): Promise<void> {
    await client.patch(`/categories/${id}/activate`);
  },
};
