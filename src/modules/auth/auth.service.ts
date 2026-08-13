import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { AuthUser } from '../../common/types/database.types';

@Injectable()
export class AuthService {
  constructor(private readonly supabase: SupabaseService) {}

  async getProfile(user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id, email, full_name, created_at, updated_at')
      .eq('id', user.id)
      .single();

    if (error) throw error;
    return data;
  }
}
