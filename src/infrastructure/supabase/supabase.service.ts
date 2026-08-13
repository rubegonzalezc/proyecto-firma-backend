import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private adminClient!: SupabaseClient;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const url = this.config.getOrThrow<string>('supabase.url');
    const serviceKey = this.config.getOrThrow<string>('supabase.serviceRoleKey');

    this.adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  get admin(): SupabaseClient {
    return this.adminClient;
  }

  get documentsBucket(): string {
    return this.config.getOrThrow<string>('supabase.documentsBucket');
  }
}
