
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "favorite_heroes": {
                  Row: {
                    "created_at": string,"hero_id": number,"position": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"hero_id": number,"position"?: number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"hero_id"?: number,"position"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "favorite_heroes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"favorite_positions": {
                  Row: {
                    "created_at": string,"position": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"position": number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"position"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "favorite_positions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"friendships": {
                  Row: {
                    "accepted_at": string | null,"addressee_id": string,"created_at": string,"requester_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"addressee_id": string,"created_at"?: string,"requester_id": string,"status"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"addressee_id"?: string,"created_at"?: string,"requester_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "friendships_addressee_id_fkey"
      columns: ["addressee_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "friendships_requester_id_fkey"
      columns: ["requester_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"parties": {
                  Row: {
                    "closed_at": string | null,"created_at": string,"id": string,"leader_id": string,"team_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"created_at"?: string,"id"?: string,"leader_id": string,"team_id"?: string | null
                  }
                  Update: {
                    "closed_at"?: string | null,"created_at"?: string,"id"?: string,"leader_id"?: string,"team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "parties_leader_id_fkey"
      columns: ["leader_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "parties_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"party_invites": {
                  Row: {
                    "created_at": string,"invited_by": string,"party_id": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invited_by": string,"party_id": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"invited_by"?: string,"party_id"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_invites_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_invites_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_invites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"party_members": {
                  Row: {
                    "joined_at": string,"party_id": string,"position": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "joined_at"?: string,"party_id": string,"position"?: number | null,"user_id": string
                  }
                  Update: {
                    "joined_at"?: string,"party_id"?: string,"position"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_members_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"friend_code": string,"hero_stats": NonNullable<Json>,"id": string,"rank_tier": number | null,"steam_id": string | null,"steam_name": string | null,"synced_at": string | null,"updated_at": string,"user_type": string,"rank_bracket": number | null
                  }
                  ComputedFields: "rank_bracket"
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"friend_code"?: string,"hero_stats"?: NonNullable<Json>,"id": string,"rank_tier"?: number | null,"steam_id"?: string | null,"steam_name"?: string | null,"synced_at"?: string | null,"updated_at"?: string,"user_type"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"friend_code"?: string,"hero_stats"?: NonNullable<Json>,"id"?: string,"rank_tier"?: number | null,"steam_id"?: string | null,"steam_name"?: string | null,"synced_at"?: string | null,"updated_at"?: string,"user_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"steam_link_requests": {
                  Row: {
                    "created_at": string,"id": string,"next": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"next"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"next"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "steam_link_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"team_invites": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"id": string,"sent_at": string,"sent_by": string | null,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"id"?: string,"sent_at"?: string,"sent_by"?: string | null,"team_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"id"?: string,"sent_at"?: string,"sent_by"?: string | null,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_invites_sent_by_fkey"
      columns: ["sent_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_invites_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_lineups": {
                  Row: {
                    "rank_bracket": number | null,"slots": (string)[],"team_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "rank_bracket"?: number | null,"slots"?: (string)[],"team_id": string,"updated_at"?: string
                  }
                  Update: {
                    "rank_bracket"?: number | null,"slots"?: (string)[],"team_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_lineups_team_id_fkey"
      columns: ["team_id"]
isOneToOne: true
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "joined_at": string,"role": string,"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "joined_at"?: string,"role"?: string,"team_id": string,"user_id": string
                  }
                  Update: {
                    "joined_at"?: string,"role"?: string,"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_friend_request":
{ Args: { "requester": string }; Returns: undefined
                           },
"accept_team_invite":
{ Args: { "invite": string }; Returns: string
                           },
"answer_party_invite":
{ Args: { "accept": boolean,"party": string }; Returns: undefined
                           },
"can_invite":
{ Args: { "target": string }; Returns: boolean
                           },
"friend_suggestions":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"team_name": string,"user_id": string
            }[]
                           },
"get_team_invite":
{ Args: { "invite": string }; Returns: {
              "accepted": boolean,"captain_name": string,"email": string,"expired": boolean,"team_name": string
            }[]
                           },
"in_party":
{ Args: { "party": string }; Returns: boolean
                           },
"invite_to_party":
{ Args: { "target": string }; Returns: undefined
                           },
"invited_to_party":
{ Args: { "party": string }; Returns: boolean
                           },
"is_captain":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_my_member":
{ Args: { "member": string }; Returns: boolean
                           },
"is_team_member":
{ Args: { "team": string }; Returns: boolean
                           },
"leave_party":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"my_friends":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"incoming": boolean,"since": string,"status": string,"steam_linked": boolean,"user_id": string
            }[]
                           },
"my_party":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_party_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"invited_by": string,"inviter_avatar_url": string,"inviter_name": string,"members": number,"party_id": string
            }[]
                           },
"owns_team":
{ Args: { "team": string }; Returns: boolean
                           },
"party_view":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"joined_at": string,"leader_id": string,"party_id": string,"position": number,"team_id": string,"user_id": string
            }[]
                           },
"profile_by_friend_code":
{ Args: { "code": string }; Returns: {
              "avatar_url": string,"display_name": string,"id": string
            }[]
                           },
"rank_bracket":
{ Args: { "p": Omit<Database["public"]['Tables']["profiles"]['Row'], Database["public"]['Tables']["profiles"]['ComputedFields']> }; Returns: number
                           },
"remove_from_party":
{ Args: { "target": string }; Returns: undefined
                           },
"runs_team":
{ Args: { "team": string }; Returns: boolean
                           },
"send_friend_request":
{ Args: { "target": string }; Returns: string
                           },
"set_party_position":
{ Args: { "want": number }; Returns: undefined
                           },
"start_party":
{ Args: { "team"?: string }; Returns: string
                           },
"user_id_by_email":
{ Args: { "address": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
