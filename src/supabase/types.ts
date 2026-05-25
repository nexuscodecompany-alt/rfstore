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
    PostgrestVersion: "13.0.4"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line1: string
          address_line2: string | null
          city: string
          country: string
          created_at: string
          customer_id: string | null
          id: string
          postal_code: string | null
          state: string
        }
        Insert: {
          address_line1: string
          address_line2?: string | null
          city: string
          country?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          postal_code?: string | null
          state: string
        }
        Update: {
          address_line1?: string
          address_line2?: string | null
          city?: string
          country?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          postal_code?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      cdr_catalog_cache: {
        Row: {
          cached_at: string
          data: Json
          external_code: string
        }
        Insert: {
          cached_at?: string
          data: Json
          external_code: string
        }
        Update: {
          cached_at?: string
          data?: Json
          external_code?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          id: number
          order_id: number
          price: number
          quantity: number
          variant_id: string
        }
        Insert: {
          created_at?: string
          id?: number
          order_id: number
          price: number
          quantity: number
          variant_id: string
        }
        Update: {
          created_at?: string
          id?: number
          order_id?: number
          price?: number
          quantity?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string
          created_at: string
          customer_id: string
          id: number
          mp_payment_id: string | null
          mp_preference_id: string | null
          paid_at: string | null
          payment_method: string | null
          payment_proof_url: string | null
          payment_status: string
          status: string
          total_amount: number
        }
        Insert: {
          address_id: string
          created_at?: string
          customer_id: string
          id?: number
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          status?: string
          total_amount: number
        }
        Update: {
          address_id?: string
          created_at?: string
          customer_id?: string
          id?: number
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          status?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      post_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          image_url: string
          post_id: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          image_url: string
          post_id: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          image_url?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_images_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          content: string
          cover_image_url: string | null
          created_at: string
          id: string
          slug: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          cover_image_url?: string | null
          created_at?: string
          id?: string
          slug?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          cover_image_url?: string | null
          created_at?: string
          id?: string
          slug?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand_id: string
          category_id: string | null
          created_at: string
          description: Json
          external_code: string | null
          features: string[]
          id: string
          image_md5s: Json | null
          images: string[]
          last_synced_at: string | null
          markup_percent: number | null
          name: string
          price_usd: number | null
          slug: string
          source: string
          subcategory_id: string | null
        }
        Insert: {
          brand_id: string
          category_id?: string | null
          created_at?: string
          description: Json
          external_code?: string | null
          features: string[]
          id?: string
          image_md5s?: Json | null
          images: string[]
          last_synced_at?: string | null
          markup_percent?: number | null
          name: string
          price_usd?: number | null
          slug: string
          source?: string
          subcategory_id?: string | null
        }
        Update: {
          brand_id?: string
          category_id?: string | null
          created_at?: string
          description?: Json
          external_code?: string | null
          features?: string[]
          id?: string
          image_md5s?: Json | null
          images?: string[]
          last_synced_at?: string | null
          markup_percent?: number | null
          name?: string
          price_usd?: number | null
          slug?: string
          source?: string
          subcategory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: number
          role: string
          user_id: string | null
        }
        Insert: {
          id?: number
          role: string
          user_id?: string | null
        }
        Update: {
          id?: number
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      variants: {
        Row: {
          color: string
          color_name: string
          id: string
          price: number
          product_id: string
          stock: number
          storage: string
        }
        Insert: {
          color: string
          color_name: string
          id?: string
          price: number
          product_id: string
          stock: number
          storage: string
        }
        Update: {
          color?: string
          color_name?: string
          id?: string
          price?: number
          product_id?: string
          stock?: number
          storage?: string
        }
        Relationships: [
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_price"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_price_v2"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      products_with_price: {
        Row: {
          brand_id: string | null
          category_id: string | null
          created_at: string | null
          description: Json | null
          external_code: string | null
          features: string[] | null
          id: string | null
          images: string[] | null
          name: string | null
          price: number | null
          slug: string | null
          source: string | null
          subcategory_id: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: Json | null
          external_code?: string | null
          features?: string[] | null
          id?: string | null
          images?: string[] | null
          name?: string | null
          price?: never
          slug?: string | null
          source?: string | null
          subcategory_id?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: Json | null
          external_code?: string | null
          features?: string[] | null
          id?: string | null
          images?: string[] | null
          name?: string | null
          price?: never
          slug?: string | null
          source?: string | null
          subcategory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "subcategories"
            referencedColumns: ["id"]
          },
        ]
      }
      products_with_price_v2: {
        Row: {
          brand_id: string | null
          category_id: string | null
          created_at: string | null
          description: Json | null
          features: string[] | null
          id: string | null
          images: string[] | null
          name: string | null
          price: number | null
          slug: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: Json | null
          features?: string[] | null
          id?: string | null
          images?: string[] | null
          name?: string | null
          price?: never
          slug?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          description?: Json | null
          features?: string[] | null
          id?: string | null
          images?: string[] | null
          name?: string | null
          price?: never
          slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      dashboard_overview: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      dashboard_sales_timeseries: {
        Args: { p_from: string; p_to: string }
        Returns: {
          amount: number
          day: string
          orders: number
        }[]
      }
      dashboard_top_brands: {
        Args: { p_limit?: number }
        Returns: {
          name: string
          products: number
        }[]
      }
      dashboard_top_products: {
        Args: {
          p_direction?: string
          p_from: string
          p_limit?: number
          p_to: string
        }
        Returns: {
          image: string
          name: string
          product_id: string
          revenue: number
          units: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      rf_sale_price: { Args: { cost: number }; Returns: number }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
