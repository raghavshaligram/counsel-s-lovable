export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      case_sessions: {
        Row: {
          created_at: string
          id: string
          manifest: Json
          name: string
          source_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manifest?: Json
          name: string
          source_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          manifest?: Json
          name?: string
          source_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      compliance_certificates: {
        Row: {
          case_label: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          source_name: string
          user_id: string
        }
        Insert: {
          case_label?: string | null
          created_at?: string
          id?: string
          kind: string
          payload: Json
          source_name: string
          user_id: string
        }
        Update: {
          case_label?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          source_name?: string
          user_id?: string
        }
        Relationships: []
      }
      firm_templates: {
        Row: {
          config: Json
          created_at: string
          id: string
          kind: string
          name: string
          source_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          kind: string
          name: string
          source_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          kind?: string
          name?: string
          source_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_dismissals: {
        Row: {
          dismissed_at: string
          notification_id: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          notification_id: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          notification_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_dismissals_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          enabled: boolean
          ends_at: string | null
          id: string
          link_url: string | null
          starts_at: string | null
          target_plan: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          link_url?: string | null
          starts_at?: string | null
          target_plan?: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          enabled?: boolean
          ends_at?: string | null
          id?: string
          link_url?: string | null
          starts_at?: string | null
          target_plan?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      offer_dismissals: {
        Row: {
          dismissed_at: string
          offer_id: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          offer_id: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          offer_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_dismissals_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          checkout_url: string | null
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          enabled: boolean
          ends_at: string | null
          id: string
          name: string
          starts_at: string | null
          stripe_coupon_id: string | null
          target_plan: string
          updated_at: string
        }
        Insert: {
          checkout_url?: string | null
          created_at?: string
          description?: string | null
          discount_type: string
          discount_value: number
          enabled?: boolean
          ends_at?: string | null
          id?: string
          name: string
          starts_at?: string | null
          stripe_coupon_id?: string | null
          target_plan?: string
          updated_at?: string
        }
        Update: {
          checkout_url?: string | null
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          enabled?: boolean
          ends_at?: string | null
          id?: string
          name?: string
          starts_at?: string | null
          stripe_coupon_id?: string | null
          target_plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string | null
          full_name: string | null
          last_active_at: string | null
          plan: string
          suspended_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          last_active_at?: string | null
          plan?: string
          suspended_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          last_active_at?: string | null
          plan?: string
          suspended_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          referrer: string | null
          source: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          referrer?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          referrer?: string | null
          source?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      subscription_plan: "free" | "solo" | "firm"
      subscription_status: "active" | "trialing" | "past_due" | "canceled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      subscription_plan: ["free", "solo", "firm"],
      subscription_status: ["active", "trialing", "past_due", "canceled"],
    },
  },
} as const
