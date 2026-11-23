// Generated from the gta6-clipper Supabase project (sxtyzccezyeltpzfqhdr).
// Regenerate after schema changes; do not edit by hand.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      clips: {
        Row: {
          channel_login: string;
          created_at: string;
          duration_seconds: number;
          error_message: string | null;
          hook_title: string;
          id: string;
          layout: string;
          moment_id: string | null;
          output_path: string;
          poster_path: string | null;
          source_path: string;
          started_at: string;
          status: string;
          workspace_id: string | null;
        };
        Insert: {
          channel_login: string;
          created_at?: string;
          duration_seconds: number;
          error_message?: string | null;
          hook_title?: string;
          id: string;
          layout: string;
          moment_id?: string | null;
          output_path: string;
          poster_path?: string | null;
          source_path: string;
          started_at: string;
          status: string;
          workspace_id?: string | null;
        };
        Update: {
          channel_login?: string;
          created_at?: string;
          duration_seconds?: number;
          error_message?: string | null;
          hook_title?: string;
          id?: string;
          layout?: string;
          moment_id?: string | null;
          output_path?: string;
          poster_path?: string | null;
          source_path?: string;
          started_at?: string;
          status?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clips_moment_id_fkey";
            columns: ["moment_id"];
            isOneToOne: false;
            referencedRelation: "moments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clips_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      moments: {
        Row: {
          baseline_rate: number;
          channel_id: string | null;
          channel_login: string;
          created_at: string;
          hype_score: number;
          id: string;
          message_rate: number;
          peak_at: string;
          reasons: Json;
          started_at: string;
          stream_id: string | null;
          workspace_id: string | null;
          z_score: number;
        };
        Insert: {
          baseline_rate?: number;
          channel_id?: string | null;
          channel_login: string;
          created_at?: string;
          hype_score: number;
          id: string;
          message_rate?: number;
          peak_at: string;
          reasons?: Json;
          started_at: string;
          stream_id?: string | null;
          workspace_id?: string | null;
          z_score?: number;
        };
        Update: {
          baseline_rate?: number;
          channel_id?: string | null;
          channel_login?: string;
          created_at?: string;
          hype_score?: number;
          id?: string;
          message_rate?: number;
          peak_at?: string;
          reasons?: Json;
          started_at?: string;
          stream_id?: string | null;
          workspace_id?: string | null;
          z_score?: number;
        };
        Relationships: [
          {
            foreignKeyName: "moments_stream_id_fkey";
            columns: ["stream_id"];
            isOneToOne: false;
            referencedRelation: "streams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moments_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      permission_receipts: {
        Row: {
          channel_id: string | null;
          channel_login: string;
          confirmed_at: string;
          confirmed_by: string | null;
          id: string;
          notes: string | null;
          source: string;
          workspace_id: string;
        };
        Insert: {
          channel_id?: string | null;
          channel_login: string;
          confirmed_at?: string;
          confirmed_by?: string | null;
          id?: string;
          notes?: string | null;
          source: string;
          workspace_id: string;
        };
        Update: {
          channel_id?: string | null;
          channel_login?: string;
          confirmed_at?: string;
          confirmed_by?: string | null;
          id?: string;
          notes?: string | null;
          source?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "permission_receipts_confirmed_by_fkey";
            columns: ["confirmed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "permission_receipts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          account_ref: string | null;
          clip_id: string;
          created_at: string;
          error_message: string | null;
          external_id: string | null;
          id: string;
          platform: string;
          posted_at: string | null;
          status: string;
          url: string | null;
          workspace_id: string | null;
        };
        Insert: {
          account_ref?: string | null;
          clip_id: string;
          created_at?: string;
          error_message?: string | null;
          external_id?: string | null;
          id?: string;
          platform: string;
          posted_at?: string | null;
          status?: string;
          url?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          account_ref?: string | null;
          clip_id?: string;
          created_at?: string;
          error_message?: string | null;
          external_id?: string | null;
          id?: string;
          platform?: string;
          posted_at?: string | null;
          status?: string;
          url?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "posts_clip_id_fkey";
            columns: ["clip_id"];
            isOneToOne: false;
            referencedRelation: "clips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "posts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      streams: {
        Row: {
          channel_id: string | null;
          channel_login: string;
          id: string;
          language: string;
          thumbnail_url: string;
          title: string;
          updated_at: string;
          url: string;
          viewer_count: number;
          workspace_id: string | null;
        };
        Insert: {
          channel_id?: string | null;
          channel_login: string;
          id?: string;
          language?: string;
          thumbnail_url?: string;
          title?: string;
          updated_at?: string;
          url?: string;
          viewer_count?: number;
          workspace_id?: string | null;
        };
        Update: {
          channel_id?: string | null;
          channel_login?: string;
          id?: string;
          language?: string;
          thumbnail_url?: string;
          title?: string;
          updated_at?: string;
          url?: string;
          viewer_count?: number;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "streams_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string;
          current_period_end: string | null;
          id: string;
          plan_id: string;
          provider: string | null;
          provider_ref: string | null;
          status: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan_id: string;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          current_period_end?: string | null;
          id?: string;
          plan_id?: string;
          provider?: string | null;
          provider_ref?: string | null;
          status?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: true;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
          twitch_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          twitch_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
          twitch_user_id?: string | null;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          role?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
