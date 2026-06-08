export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      admin_notifications: {
        Row: {
          created_at: string
          id: number
          payload: Json
          read_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: number
          payload?: Json
          read_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: number
          payload?: Json
          read_at?: string | null
          type?: string
        }
        Relationships: []
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
          hidden: boolean
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string
          hidden?: boolean
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          hidden?: boolean
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
      ml_attribute_defaults: {
        Row: {
          attribute_id: string
          id: number
          ml_category_id: string
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          attribute_id: string
          id?: number
          ml_category_id: string
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          attribute_id?: string
          id?: number
          ml_category_id?: string
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: []
      }
      ml_credentials: {
        Row: {
          access_token: string
          created_at: string | null
          expires_at: string
          id: number
          ml_nickname: string | null
          ml_user_id: number
          refresh_token: string
          scope: string | null
          token_type: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          expires_at: string
          id?: number
          ml_nickname?: string | null
          ml_user_id: number
          refresh_token: string
          scope?: string | null
          token_type?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          expires_at?: string
          id?: number
          ml_nickname?: string | null
          ml_user_id?: number
          refresh_token?: string
          scope?: string | null
          token_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ml_item_mapping: {
        Row: {
          created_at: string | null
          id: number
          last_error: string | null
          last_known_price_uyu: number | null
          last_known_stock: number | null
          last_synced_at: string | null
          ml_category_id: string
          ml_item_id: string
          ml_listing_type: string
          permalink: string | null
          product_id: string
          status: string
          updated_at: string | null
          variant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: number
          last_error?: string | null
          last_known_price_uyu?: number | null
          last_known_stock?: number | null
          last_synced_at?: string | null
          ml_category_id: string
          ml_item_id: string
          ml_listing_type?: string
          permalink?: string | null
          product_id: string
          status?: string
          updated_at?: string | null
          variant_id: string
        }
        Update: {
          created_at?: string | null
          id?: number
          last_error?: string | null
          last_known_price_uyu?: number | null
          last_known_stock?: number | null
          last_synced_at?: string | null
          ml_category_id?: string
          ml_item_id?: string
          ml_listing_type?: string
          permalink?: string | null
          product_id?: string
          status?: string
          updated_at?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_item_mapping_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_item_mapping_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_product_overrides: {
        Row: {
          attributes_override: Json | null
          brand: string | null
          color: string | null
          created_at: string | null
          description_override: string | null
          gtin: string | null
          height_cm: number | null
          id: number
          internal_memory: string | null
          length_cm: number | null
          model: string | null
          product_id: string
          ram: string | null
          title_override: string | null
          updated_at: string | null
          variant_id: string | null
          warranty_months: number | null
          warranty_type: string | null
          weight_grams: number | null
          width_cm: number | null
        }
        Insert: {
          attributes_override?: Json | null
          brand?: string | null
          color?: string | null
          created_at?: string | null
          description_override?: string | null
          gtin?: string | null
          height_cm?: number | null
          id?: number
          internal_memory?: string | null
          length_cm?: number | null
          model?: string | null
          product_id: string
          ram?: string | null
          title_override?: string | null
          updated_at?: string | null
          variant_id?: string | null
          warranty_months?: number | null
          warranty_type?: string | null
          weight_grams?: number | null
          width_cm?: number | null
        }
        Update: {
          attributes_override?: Json | null
          brand?: string | null
          color?: string | null
          created_at?: string | null
          description_override?: string | null
          gtin?: string | null
          height_cm?: number | null
          id?: number
          internal_memory?: string | null
          length_cm?: number | null
          model?: string | null
          product_id?: string
          ram?: string | null
          title_override?: string | null
          updated_at?: string | null
          variant_id?: string | null
          warranty_months?: number | null
          warranty_type?: string | null
          weight_grams?: number | null
          width_cm?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_product_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_product_overrides_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_sync_queue: {
        Row: {
          attempts: number
          created_at: string | null
          id: number
          last_error: string | null
          ml_item_id: string | null
          operation: string
          payload: Json | null
          processed_at: string | null
          product_id: string | null
          scheduled_for: string | null
          status: string
          variant_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string | null
          id?: number
          last_error?: string | null
          ml_item_id?: string | null
          operation: string
          payload?: Json | null
          processed_at?: string | null
          product_id?: string | null
          scheduled_for?: string | null
          status?: string
          variant_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string | null
          id?: number
          last_error?: string | null
          ml_item_id?: string | null
          operation?: string
          payload?: Json | null
          processed_at?: string | null
          product_id?: string | null
          scheduled_for?: string | null
          status?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_sync_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_sync_queue_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_webhook_events: {
        Row: {
          application_id: string | null
          error: string | null
          id: number
          payload: Json | null
          processed_at: string | null
          processing_status: string
          received_at: string | null
          resource: string | null
          sent_at: string | null
          topic: string
          user_id: string | null
        }
        Insert: {
          application_id?: string | null
          error?: string | null
          id?: number
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          received_at?: string | null
          resource?: string | null
          sent_at?: string | null
          topic: string
          user_id?: string | null
        }
        Update: {
          application_id?: string | null
          error?: string | null
          id?: number
          payload?: Json | null
          processed_at?: string | null
          processing_status?: string
          received_at?: string | null
          resource?: string | null
          sent_at?: string | null
          topic?: string
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
          address_id: string | null
          channel: string
          created_at: string
          customer_id: string | null
          id: number
          ml_order_id: string | null
          ml_pack_id: string | null
          mp_payment_id: string | null
          mp_preference_id: string | null
          paid_at: string | null
          payment_method: string | null
          payment_proof_url: string | null
          payment_status: string
          shipping_barrio: string | null
          shipping_cost_usd: number | null
          shipping_department: string | null
          shipping_zone: string | null
          status: string
          total_amount: number
        }
        Insert: {
          address_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          id?: number
          ml_order_id?: string | null
          ml_pack_id?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          shipping_barrio?: string | null
          shipping_cost_usd?: number | null
          shipping_department?: string | null
          shipping_zone?: string | null
          status?: string
          total_amount: number
        }
        Update: {
          address_id?: string | null
          channel?: string
          created_at?: string
          customer_id?: string | null
          id?: number
          ml_order_id?: string | null
          ml_pack_id?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_proof_url?: string | null
          payment_status?: string
          shipping_barrio?: string | null
          shipping_cost_usd?: number | null
          shipping_department?: string | null
          shipping_zone?: string | null
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
          active: boolean
          brand_id: string | null
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
          active?: boolean
          brand_id?: string | null
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
          active?: boolean
          brand_id?: string | null
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
          featured_score: number | null
          features: string[] | null
          id: string | null
          images: string[] | null
          name: string | null
          price: number | null
          slug: string | null
          source: string | null
          subcategory_id: string | null
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
      cdr_sync_newonly_tick: { Args: Record<string, never>; Returns: undefined }
      cdr_sync_tick: { Args: Record<string, never>; Returns: undefined }
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
      expire_pending_orders_tick: { Args: Record<string, never>; Returns: undefined }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      place_cdr_order: {
        Args: {
          p_address: Json
          p_items: Json
          p_payment_method: string
          p_shipping_barrio: string
          p_shipping_cost_usd: number
          p_shipping_department: string
          p_shipping_zone: string
          p_total: number
        }
        Returns: number
      }
      place_order: {
        Args: { p_address: Json; p_items: Json; p_total: number }
        Returns: number
      }
      release_order_stock: {
        Args: { p_new_status: string; p_order_id: number }
        Returns: boolean
      }
      reserved_quantity_for_product: {
        Args: { p_external_code: string }
        Returns: number
      }
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
