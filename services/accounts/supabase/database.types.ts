
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
            "draft_actions": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"draft_id": string,"hero_id": number,"id": number,"kind": string,"position": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"draft_id": string,"hero_id": number,"id"?: never,"kind": string,"position"?: number | null
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"draft_id"?: string,"hero_id"?: number,"id"?: never,"kind"?: string,"position"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "draft_actions_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_actions_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"draft_players": {
                  Row: {
                    "account_id": number | null,"draft_id": string,"hero_id": number | null,"hero_source": string | null,"position": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: number | null,"draft_id": string,"hero_id"?: number | null,"hero_source"?: string | null,"position"?: number | null,"user_id": string
                  }
                  Update: {
                    "account_id"?: number | null,"draft_id"?: string,"hero_id"?: number | null,"hero_source"?: string | null,"position"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "draft_players_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_players_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"draft_suggestions": {
                  Row: {
                    "draft_id": string,"first_shown_at": string,"heroes": (number)[],"position": number,"scores": (number)[],"updated_at": string,"user_id": string,"win_chance": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "draft_id": string,"first_shown_at"?: string,"heroes": (number)[],"position": number,"scores": (number)[],"updated_at"?: string,"user_id": string,"win_chance"?: number | null
                  }
                  Update: {
                    "draft_id"?: string,"first_shown_at"?: string,"heroes"?: (number)[],"position"?: number,"scores"?: (number)[],"updated_at"?: string,"user_id"?: string,"win_chance"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "draft_suggestions_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "draft_suggestions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"favorite_heroes": {
                  Row: {
                    "copied_from": number | null,"created_at": string,"hero_id": number,"position": number,"top_slot": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "copied_from"?: number | null,"created_at"?: string,"hero_id": number,"position"?: number,"top_slot"?: number | null,"user_id": string
                  }
                  Update: {
                    "copied_from"?: number | null,"created_at"?: string,"hero_id"?: number,"position"?: number,"top_slot"?: number | null,"user_id"?: string
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
                },"game_check_ins": {
                  Row: {
                    "allies": (number)[],"ally_positions": (number)[],"answered_at": string | null,"bans": (number)[],"client_key": string | null,"empty_finds": number,"enemies": (number)[],"filled_at": string,"find_tries": number,"id": string,"match_id": number | null,"my_hero": number | null,"my_position": number,"note": string | null,"party_draft_id": string | null,"picks_feel": string | null,"played": boolean | null,"player_won": boolean | null,"profile_hidden": boolean,"result_checked_at": string | null,"shown": (number)[],"skipped_at": string | null,"snoozed_until": string | null,"snoozes": number,"started_at": string | null,"story_feel": string | null,"story_shown": boolean,"tags": (string)[],"updated_at": string,"user_id": string,"won": boolean | null,"check_in_result": {
              "match_id": number,"won": boolean
            } | null
                  }
                  ComputedFields: "check_in_result"
                  Insert: {
                    "allies": (number)[],"ally_positions": (number)[],"answered_at"?: string | null,"bans"?: (number)[],"client_key"?: string | null,"empty_finds"?: number,"enemies": (number)[],"filled_at"?: string,"find_tries"?: number,"id"?: string,"match_id"?: number | null,"my_hero"?: number | null,"my_position": number,"note"?: string | null,"party_draft_id"?: string | null,"picks_feel"?: string | null,"played"?: boolean | null,"player_won"?: boolean | null,"profile_hidden"?: boolean,"result_checked_at"?: string | null,"shown"?: (number)[],"skipped_at"?: string | null,"snoozed_until"?: string | null,"snoozes"?: number,"started_at"?: string | null,"story_feel"?: string | null,"story_shown"?: boolean,"tags"?: (string)[],"updated_at"?: string,"user_id": string,"won"?: boolean | null
                  }
                  Update: {
                    "allies"?: (number)[],"ally_positions"?: (number)[],"answered_at"?: string | null,"bans"?: (number)[],"client_key"?: string | null,"empty_finds"?: number,"enemies"?: (number)[],"filled_at"?: string,"find_tries"?: number,"id"?: string,"match_id"?: number | null,"my_hero"?: number | null,"my_position"?: number,"note"?: string | null,"party_draft_id"?: string | null,"picks_feel"?: string | null,"played"?: boolean | null,"player_won"?: boolean | null,"profile_hidden"?: boolean,"result_checked_at"?: string | null,"shown"?: (number)[],"skipped_at"?: string | null,"snoozed_until"?: string | null,"snoozes"?: number,"started_at"?: string | null,"story_feel"?: string | null,"story_shown"?: boolean,"tags"?: (string)[],"updated_at"?: string,"user_id"?: string,"won"?: boolean | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_check_ins_party_draft_id_fkey"
      columns: ["party_draft_id"]
isOneToOne: false
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "game_check_ins_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hero_benchmarks": {
                  Row: {
                    "benchmarks": NonNullable<Json>,"fetched_at": string,"hero_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "benchmarks": NonNullable<Json>,"fetched_at"?: string,"hero_id": number
                  }
                  Update: {
                    "benchmarks"?: NonNullable<Json>,"fetched_at"?: string,"hero_id"?: number
                  }
                  Relationships: [
                    
                  ]
                },"hero_fill_picks": {
                  Row: {
                    "filled_at": string,"games": number,"games_needed": number | null,"hero_id": number,"judged_games": number,"kind": string,"last_played": string,"position": number,"strong_games": number,"user_id": string,"wins": number
                  }
                  ComputedFields: never
                  Insert: {
                    "filled_at"?: string,"games": number,"games_needed"?: number | null,"hero_id": number,"judged_games": number,"kind": string,"last_played": string,"position": number,"strong_games": number,"user_id": string,"wins": number
                  }
                  Update: {
                    "filled_at"?: string,"games"?: number,"games_needed"?: number | null,"hero_id"?: number,"judged_games"?: number,"kind"?: string,"last_played"?: string,"position"?: number,"strong_games"?: number,"user_id"?: string,"wins"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "hero_fill_picks_user_id_position_hero_id_fkey"
      columns: ["user_id","position","hero_id"]
isOneToOne: true
      referencedRelation: "favorite_heroes"
      referencedColumns: ["user_id","position","hero_id"]
    }
                  ]
                },"invite_sends": {
                  Row: {
                    "email": string,"id": number,"sender_id": string,"sent_at": string,"team_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"id"?: never,"sender_id": string,"sent_at"?: string,"team_id"?: string | null
                  }
                  Update: {
                    "email"?: string,"id"?: never,"sender_id"?: string,"sent_at"?: string,"team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invite_sends_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"match_files": {
                  Row: {
                    "match_id": number,"saved_at": string,"size_bytes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "match_id": number,"saved_at"?: string,"size_bytes": number
                  }
                  Update: {
                    "match_id"?: number,"saved_at"?: string,"size_bytes"?: number
                  }
                  Relationships: [
                    
                  ]
                },"match_reports": {
                  Row: {
                    "attempts": number,"created_at": string,"draft_id": string,"error": string | null,"facts": Json | null,"facts_version": number | null,"game_mode": number | null,"lease_until": string | null,"lobby_type": number | null,"match_id": number,"next_try_at": string,"parse_requested_at": string | null,"parse_requests": number,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"draft_id": string,"error"?: string | null,"facts"?: Json | null,"facts_version"?: number | null,"game_mode"?: number | null,"lease_until"?: string | null,"lobby_type"?: number | null,"match_id": number,"next_try_at"?: string,"parse_requested_at"?: string | null,"parse_requests"?: number,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"draft_id"?: string,"error"?: string | null,"facts"?: Json | null,"facts_version"?: number | null,"game_mode"?: number | null,"lease_until"?: string | null,"lobby_type"?: number | null,"match_id"?: number,"next_try_at"?: string,"parse_requested_at"?: string | null,"parse_requests"?: number,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "match_reports_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: true
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    }
                  ]
                },"matchup_fetches": {
                  Row: {
                    "claimed_at": string,"enemy_id": number,"game_version": number,"hero_id": number,"position": number
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string,"enemy_id": number,"game_version": number,"hero_id": number,"position": number
                  }
                  Update: {
                    "claimed_at"?: string,"enemy_id"?: number,"game_version"?: number,"hero_id"?: number,"position"?: number
                  }
                  Relationships: [
                    
                  ]
                },"matchup_guides": {
                  Row: {
                    "enemy_id": number,"fetched_at": string,"game_version": number,"games": NonNullable<Json>,"hero_id": number,"position": number
                  }
                  ComputedFields: never
                  Insert: {
                    "enemy_id": number,"fetched_at"?: string,"game_version": number,"games": NonNullable<Json>,"hero_id": number,"position": number
                  }
                  Update: {
                    "enemy_id"?: number,"fetched_at"?: string,"game_version"?: number,"games"?: NonNullable<Json>,"hero_id"?: number,"position"?: number
                  }
                  Relationships: [
                    
                  ]
                },"matchup_lookups": {
                  Row: {
                    "looked_up_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "looked_up_at"?: string,"user_id": string
                  }
                  Update: {
                    "looked_up_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"opendota_caller_calls": {
                  Row: {
                    "caller": string,"calls": number,"day": string
                  }
                  ComputedFields: never
                  Insert: {
                    "caller": string,"calls": number,"day": string
                  }
                  Update: {
                    "caller"?: string,"calls"?: number,"day"?: string
                  }
                  Relationships: [
                    
                  ]
                },"opendota_calls": {
                  Row: {
                    "calls": number,"day": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls": number,"day": string
                  }
                  Update: {
                    "calls"?: number,"day"?: string
                  }
                  Relationships: [
                    
                  ]
                },"parties": {
                  Row: {
                    "captain_id": string | null,"captain_request_at": string | null,"captain_request_by": string | null,"closed_at": string | null,"created_at": string,"id": string,"leader_id": string | null,"rank_bracket": number | null,"team_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "captain_id"?: string | null,"captain_request_at"?: string | null,"captain_request_by"?: string | null,"closed_at"?: string | null,"created_at"?: string,"id"?: string,"leader_id"?: string | null,"rank_bracket"?: number | null,"team_id"?: string | null
                  }
                  Update: {
                    "captain_id"?: string | null,"captain_request_at"?: string | null,"captain_request_by"?: string | null,"closed_at"?: string | null,"created_at"?: string,"id"?: string,"leader_id"?: string | null,"rank_bracket"?: number | null,"team_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "parties_captain_id_fkey"
      columns: ["captain_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "parties_captain_request_by_fkey"
      columns: ["captain_request_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
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
                },"party_captain_seen": {
                  Row: {
                    "party_id": string,"seen_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "party_id": string,"seen_at"?: string
                  }
                  Update: {
                    "party_id"?: string,"seen_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_captain_seen_party_id_fkey"
      columns: ["party_id"]
isOneToOne: true
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"party_drafts": {
                  Row: {
                    "created_at": string,"ended_at": string | null,"find_tries": number,"id": string,"match_id": number | null,"party_id": string,"result_checked_at": string | null,"started_by": string | null,"won": boolean | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ended_at"?: string | null,"find_tries"?: number,"id"?: string,"match_id"?: number | null,"party_id": string,"result_checked_at"?: string | null,"started_by"?: string | null,"won"?: boolean | null
                  }
                  Update: {
                    "created_at"?: string,"ended_at"?: string | null,"find_tries"?: number,"id"?: string,"match_id"?: number | null,"party_id"?: string,"result_checked_at"?: string | null,"started_by"?: string | null,"won"?: boolean | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_drafts_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_drafts_started_by_fkey"
      columns: ["started_by"]
isOneToOne: false
      referencedRelation: "profiles"
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
                },"party_kicks": {
                  Row: {
                    "party_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "party_id": string,"user_id": string
                  }
                  Update: {
                    "party_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_kicks_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_kicks_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"party_links": {
                  Row: {
                    "code": string,"expires_at": string,"party_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"expires_at": string,"party_id": string
                  }
                  Update: {
                    "code"?: string,"expires_at"?: string,"party_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_links_party_id_fkey"
      columns: ["party_id"]
isOneToOne: true
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"party_members": {
                  Row: {
                    "captain_asked_at": string | null,"joined_at": string,"party_id": string,"position": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "captain_asked_at"?: string | null,"joined_at"?: string,"party_id": string,"position"?: number | null,"user_id": string
                  }
                  Update: {
                    "captain_asked_at"?: string | null,"joined_at"?: string,"party_id"?: string,"position"?: number | null,"user_id"?: string
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
                },"player_feedback": {
                  Row: {
                    "findings": NonNullable<Json>,"first_game_at": string | null,"games": number,"improved": NonNullable<Json>,"last_game_at": string | null,"parsed_games": number,"updated_at": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "findings": NonNullable<Json>,"first_game_at"?: string | null,"games": number,"improved": NonNullable<Json>,"last_game_at"?: string | null,"parsed_games": number,"updated_at"?: string,"user_id": string,"version": number
                  }
                  Update: {
                    "findings"?: NonNullable<Json>,"first_game_at"?: string | null,"games"?: number,"improved"?: NonNullable<Json>,"last_game_at"?: string | null,"parsed_games"?: number,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_feedback_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"player_game_facts": {
                  Row: {
                    "attempts": number,"created_at": string,"draft_id": string | null,"duration_s": number,"error": string | null,"findings": Json | null,"findings_version": number,"hero_id": number,"is_win": boolean,"match_id": number,"next_try_at": string,"parse_requested_at": string | null,"parse_requests": number,"position": number | null,"started_at": string,"status": string,"summary": Json | null,"summary_version": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"draft_id"?: string | null,"duration_s": number,"error"?: string | null,"findings"?: Json | null,"findings_version"?: number,"hero_id": number,"is_win": boolean,"match_id": number,"next_try_at"?: string,"parse_requested_at"?: string | null,"parse_requests"?: number,"position"?: number | null,"started_at": string,"status"?: string,"summary"?: Json | null,"summary_version"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"draft_id"?: string | null,"duration_s"?: number,"error"?: string | null,"findings"?: Json | null,"findings_version"?: number,"hero_id"?: number,"is_win"?: boolean,"match_id"?: number,"next_try_at"?: string,"parse_requested_at"?: string | null,"parse_requests"?: number,"position"?: number | null,"started_at"?: string,"status"?: string,"summary"?: Json | null,"summary_version"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_game_facts_draft_id_fkey"
      columns: ["draft_id"]
isOneToOne: false
      referencedRelation: "party_drafts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "player_game_facts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"player_games": {
                  Row: {
                    "created_at": string,"game_mode": number,"hero_id": number,"imp": number | null,"is_strong": boolean | null,"is_win": boolean,"lobby_rank": number | null,"lobby_type": number,"match_id": number,"percentiles": Json | null,"position": number | null,"position_source": string | null,"started_at": string,"stat_values": Json | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"game_mode": number,"hero_id": number,"imp"?: number | null,"is_strong"?: boolean | null,"is_win": boolean,"lobby_rank"?: number | null,"lobby_type": number,"match_id": number,"percentiles"?: Json | null,"position"?: number | null,"position_source"?: string | null,"started_at": string,"stat_values"?: Json | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"game_mode"?: number,"hero_id"?: number,"imp"?: number | null,"is_strong"?: boolean | null,"is_win"?: boolean,"lobby_rank"?: number | null,"lobby_type"?: number,"match_id"?: number,"percentiles"?: Json | null,"position"?: number | null,"position_source"?: string | null,"started_at"?: string,"stat_values"?: Json | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "player_games_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"pool_removals": {
                  Row: {
                    "created_at": string,"hero_id": number,"position": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"hero_id": number,"position": number,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"hero_id"?: number,"position"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pool_removals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"pool_suggestions": {
                  Row: {
                    "answered_at": string | null,"created_at": string,"decline_count": number,"declined_at": string | null,"evidence": NonNullable<Json>,"hero_id": number,"id": string,"position": number,"question": string,"reason": string,"snooze_until": string | null,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string | null,"created_at"?: string,"decline_count"?: number,"declined_at"?: string | null,"evidence": NonNullable<Json>,"hero_id": number,"id"?: string,"position": number,"question": string,"reason": string,"snooze_until"?: string | null,"status"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "answered_at"?: string | null,"created_at"?: string,"decline_count"?: number,"declined_at"?: string | null,"evidence"?: NonNullable<Json>,"hero_id"?: number,"id"?: string,"position"?: number,"question"?: string,"reason"?: string,"snooze_until"?: string | null,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pool_suggestions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string | null,"friend_code": string,"hero_fill_at": string | null,"hero_fill_games": number | null,"hero_fill_next_at": string | null,"hero_fill_state": string | null,"hero_fill_tries": number,"hero_games": NonNullable<Json>,"hero_stats": NonNullable<Json>,"id": string,"last_active_at": string | null,"pool_suggestions_off": boolean,"rank_tier": number | null,"share_heroes_with_friends": boolean,"steam_id": string | null,"steam_name": string | null,"support_copy": string | null,"support_copy_from": number | null,"synced_at": string | null,"trends_checked_at": string | null,"trends_state": string | null,"updated_at": string,"user_type": string,"rank_bracket": number | null
                  }
                  ComputedFields: "rank_bracket"
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"friend_code"?: string,"hero_fill_at"?: string | null,"hero_fill_games"?: number | null,"hero_fill_next_at"?: string | null,"hero_fill_state"?: string | null,"hero_fill_tries"?: number,"hero_games"?: NonNullable<Json>,"hero_stats"?: NonNullable<Json>,"id": string,"last_active_at"?: string | null,"pool_suggestions_off"?: boolean,"rank_tier"?: number | null,"share_heroes_with_friends"?: boolean,"steam_id"?: string | null,"steam_name"?: string | null,"support_copy"?: string | null,"support_copy_from"?: number | null,"synced_at"?: string | null,"trends_checked_at"?: string | null,"trends_state"?: string | null,"updated_at"?: string,"user_type"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string | null,"friend_code"?: string,"hero_fill_at"?: string | null,"hero_fill_games"?: number | null,"hero_fill_next_at"?: string | null,"hero_fill_state"?: string | null,"hero_fill_tries"?: number,"hero_games"?: NonNullable<Json>,"hero_stats"?: NonNullable<Json>,"id"?: string,"last_active_at"?: string | null,"pool_suggestions_off"?: boolean,"rank_tier"?: number | null,"share_heroes_with_friends"?: boolean,"steam_id"?: string | null,"steam_name"?: string | null,"support_copy"?: string | null,"support_copy_from"?: number | null,"synced_at"?: string | null,"trends_checked_at"?: string | null,"trends_state"?: string | null,"updated_at"?: string,"user_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stratz_calls": {
                  Row: {
                    "calls": number,"hour": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calls": number,"hour": string
                  }
                  Update: {
                    "calls"?: number,"hour"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stratz_refresh": {
                  Row: {
                    "busy_until": string | null,"finished_at": string | null,"id": boolean,"last_lookup_at": string | null,"started_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "busy_until"?: string | null,"finished_at"?: string | null,"id"?: boolean,"last_lookup_at"?: string | null,"started_at"?: string | null
                  }
                  Update: {
                    "busy_until"?: string | null,"finished_at"?: string | null,"id"?: boolean,"last_lookup_at"?: string | null,"started_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"team_game_plans": {
                  Row: {
                    "bans": (number)[],"created_at": string,"enemies": (number)[],"id": string,"picks": (number)[],"players": (string)[],"rank_bracket": number | null,"sent_by": string | null,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bans"?: (number)[],"created_at"?: string,"enemies": (number)[],"id"?: string,"picks": (number)[],"players"?: (string)[],"rank_bracket"?: number | null,"sent_by"?: string | null,"team_id": string
                  }
                  Update: {
                    "bans"?: (number)[],"created_at"?: string,"enemies"?: (number)[],"id"?: string,"picks"?: (number)[],"players"?: (string)[],"rank_bracket"?: number | null,"sent_by"?: string | null,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_game_plans_sent_by_fkey"
      columns: ["sent_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_game_plans_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    }
                  ]
                },"team_invites": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"declined_at": string | null,"email": string | null,"id": string,"sent_at": string,"sent_by": string | null,"team_id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"declined_at"?: string | null,"email"?: string | null,"id"?: string,"sent_at"?: string,"sent_by"?: string | null,"team_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"declined_at"?: string | null,"email"?: string | null,"id"?: string,"sent_at"?: string,"sent_by"?: string | null,"team_id"?: string,"user_id"?: string | null
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
    },{
      foreignKeyName: "team_invites_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"team_join_requests": {
                  Row: {
                    "answered_at": string | null,"answered_by": string | null,"created_at": string,"id": string,"status": string,"team_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answered_at"?: string | null,"answered_by"?: string | null,"created_at"?: string,"id"?: string,"status"?: string,"team_id": string,"user_id": string
                  }
                  Update: {
                    "answered_at"?: string | null,"answered_by"?: string | null,"created_at"?: string,"id"?: string,"status"?: string,"team_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_join_requests_answered_by_fkey"
      columns: ["answered_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_join_requests_team_id_fkey"
      columns: ["team_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_join_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
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
                    "created_at": string,"id": string,"name": string,"open_to_requests": boolean,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"open_to_requests"?: boolean,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"open_to_requests"?: boolean,"owner_id"?: string
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
"add_draft_action":
{ Args: { "action": string,"draft": string,"hero": number,"pos"?: number }; Returns: undefined
                           },
"admin_newest_players":
{ Args: { "before_at"?: string,"before_id"?: string,"max_rows"?: number }; Returns: {
              "avatar_url": string,"display_name": string,"hero_count": number,"joined_at": string,"rank_tier": number,"steam_id": string,"user_id": string
            }[]
                           },
"admin_signup_stats":
{ Args: Record<PropertyKey, never>; Returns: {
              "first_day": string,"last_7_days": number,"per_day": (number)[],"today": number,"total": number
            }[]
                           },
"answer_captain_request":
{ Args: { "accept": boolean }; Returns: undefined
                           },
"answer_check_in":
{ Args: { "check_in": string,"decided"?: (string)[],"did_win"?: boolean,"note"?: string,"picks"?: string,"played"?: boolean,"story"?: string }; Returns: undefined
                           },
"answer_join_request":
{ Args: { "accept": boolean,"request": string }; Returns: undefined
                           },
"answer_party_invite":
{ Args: { "accept": boolean,"party": string }; Returns: undefined
                           },
"answer_pool_suggestion":
{ Args: { "answer": string,"card": string }; Returns: string
                           },
"answer_team_invite":
{ Args: { "accept": boolean,"invite": string }; Returns: string
                           },
"apply_support_copy":
{ Args: { "changed_position": number,"hero": number,"is_on": boolean,"player": string }; Returns: undefined
                           },
"ask_to_join_team":
{ Args: { "team": string }; Returns: string
                           },
"attach_draft_match":
{ Args: { "did_win": boolean,"draft": string,"lobby": number,"match": number,"mode": number,"our_players": Json }; Returns: boolean
                           },
"become_captain":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"browse_stacks":
{ Args: { "page"?: number,"search"?: string }; Returns: {
              "games": number,"id": string,"members": number,"name": string,"owner_name": string
            }[]
                           },
"can_invite":
{ Args: { "target": string }; Returns: boolean
                           },
"can_read_draft":
{ Args: { "draft": string }; Returns: boolean
                           },
"cancel_join_request":
{ Args: { "request": string }; Returns: undefined
                           },
"captain_heartbeat":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"captain_online":
{ Args: { "party": string }; Returns: boolean
                           },
"captain_timing":
{ Args: { "what": string }; Returns: string
                           },
"check_in_result":
{ Args: { "c": Omit<Database["public"]['Tables']["game_check_ins"]['Row'], Database["public"]['Tables']["game_check_ins"]['ComputedFields']> }; Returns: {
              "match_id": number,"won": boolean
            }[]
                           },
"claim_hero_fill":
{ Args: { "by": string,"player": string }; Returns: boolean
                           },
"claim_invite_send":
{ Args: { "address": string,"sender": string,"team": string }; Returns: string
                           },
"claim_match_reports":
{ Args: { "lease"?: string,"max_rows"?: number }; Returns: {
              "attempts": number,"created_at": string,"draft_id": string,"match_id": number,"parse_requested_at": string,"parse_requests": number,"won": boolean
            }[]
                           },
"claim_matchup_fetches":
{ Args: { "version": number,"wanted": Json }; Returns: Json
                           },
"claim_solo_check_ins":
{ Args: { "max_rows"?: number }; Returns: {
              "account_id": number,"allies": (number)[],"id": string,"my_hero": number,"started_at": string
            }[]
                           },
"claim_trend_players":
{ Args: { "max_rows"?: number }; Returns: {
              "account_id": number,"cards_off": boolean,"has_recent_card": boolean,"hero_stats": Json,"pool": Json,"skip": (string)[],"user_id": string
            }[]
                           },
"claim_unattached_drafts":
{ Args: { "max_rows"?: number }; Returns: {
              "account_ids": (number)[],"allies": (number)[],"created_at": string,"draft_id": string
            }[]
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"distinct_heroes":
{ Args: { "heroes": (number)[] }; Returns: boolean
                           },
"draft_state":
{ Args: { "draft": string }; Returns: {
              "hero_id": number,"kind": string,"position": number
            }[]
                           },
"due_check_in":
{ Args: { "surface": string }; Returns: {
              "allies": (number)[],"enemies": (number)[],"id": string,"match_id": number,"my_hero": number,"my_position": number,"party_draft_id": string,"started_at": string,"story_shown": boolean,"won": boolean
            }[]
                           },
"due_hero_fills":
{ Args: { "max_fills": number }; Returns: string[]
                           },
"end_party_draft":
{ Args: { "draft": string }; Returns: undefined
                           },
"fail_hero_fill":
{ Args: { "player": string }; Returns: string
                           },
"find_is_due":
{ Args: { "base": string,"checked": string,"max_tries": number,"tries": number }; Returns: boolean
                           },
"forget_match_files":
{ Args: { "matches": (number)[] }; Returns: number
                           },
"forget_old_check_ins":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"forget_old_matchups":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"friend_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "games_together": number,"games_without": number,"last_game_at": string,"last_together": string,"party_size": number,"party_state": string,"user_id": string,"wins_together": number,"wins_without": number
            }[]
                           },
"friend_suggestions":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"team_name": string,"user_id": string
            }[]
                           },
"games_with_friend":
{ Args: { "friend": string }; Returns: {
              "friend_hero_id": number,"friend_position": number,"game_mode": number,"is_win": boolean,"lobby_type": number,"match_id": number,"my_hero_id": number,"my_position": number,"started_at": string
            }[]
                           },
"get_team_invite":
{ Args: { "invite": string }; Returns: {
              "accepted": boolean,"captain_name": string,"email": string,"expired": boolean,"team_name": string
            }[]
                           },
"hero_fill_backoff":
{ Args: { "tries": number }; Returns: string
                           },
"hot_stacks":
{ Args: Record<PropertyKey, never>; Returns: {
              "games": number,"id": string,"members": number,"name": string,"owner_name": string
            }[]
                           },
"in_draft_party":
{ Args: { "draft": string }; Returns: boolean
                           },
"in_party":
{ Args: { "party": string }; Returns: boolean
                           },
"invite_friend_to_team":
{ Args: { "target": string,"team": string }; Returns: string
                           },
"invite_to_party":
{ Args: { "target": string }; Returns: undefined
                           },
"invited_to_party":
{ Args: { "party": string }; Returns: boolean
                           },
"is_my_member":
{ Args: { "member": string }; Returns: boolean
                           },
"is_team_member":
{ Args: { "team": string }; Returns: boolean
                           },
"join_party_by_link":
{ Args: { "code": string }; Returns: string
                           },
"leave_party":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"lineup_players":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"favorites": Json,"hero_stats": Json,"is_friend": boolean,"positions": (number)[],"rank_tier": number,"shared": boolean,"stacks": Json,"user_id": string
            }[]
                           },
"lock_my_party":
{ Args: Record<PropertyKey, never>; Returns: {
              "captain_id": string | null,
"captain_request_at": string | null,
"captain_request_by": string | null,
"closed_at": string | null,
"created_at": string,
"id": string,
"leader_id": string | null,
"rank_bracket": number | null,
"team_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "parties"
        isOneToOne: true
        isSetofReturn: false
      } },
"mark_active":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"mark_stratz_refresh":
{ Args: { "running": boolean }; Returns: string
                           },
"may_change_draft":
{ Args: { "draft": string }; Returns: boolean
                           },
"my_friends":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"display_name": string,"incoming": boolean,"since": string,"status": string,"steam_linked": boolean,"user_id": string
            }[]
                           },
"my_pair_records":
{ Args: Record<PropertyKey, never>; Returns: {
              "games": number,"my_position": number,"teammate_id": string,"teammate_name": string,"their_position": number,"wins": number
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
"my_record_games":
{ Args: Record<PropertyKey, never>; Returns: {
              "draft_id": string,"hero_id": number,"position": number,"won": boolean
            }[]
                           },
"my_suggestion_record":
{ Args: Record<PropertyKey, never>; Returns: {
              "bucket": string,"games": number,"wins": number
            }[]
                           },
"my_team_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "invite_id": string,"inviter_avatar_url": string,"inviter_name": string,"members": number,"sent_at": string,"team_id": string,"team_name": string
            }[]
                           },
"note_check_in_no_games":
{ Args: { "check_in": string }; Returns: undefined
                           },
"note_stratz_busy":
{ Args: { "until": string }; Returns: undefined
                           },
"owns_team":
{ Args: { "team": string }; Returns: boolean
                           },
"party_by_link":
{ Args: { "code": string }; Returns: {
              "is_kicked": boolean,"is_member": boolean,"leader_avatar_url": string,"leader_id": string,"leader_name": string,"members": number,"party_id": string
            }[]
                           },
"party_hero_pool":
{ Args: Record<PropertyKey, never>; Returns: {
              "hero_id": number,"position": number,"user_id": string
            }[]
                           },
"party_link":
{ Args: { "fresh"?: boolean }; Returns: {
              "code": string,"expires_at": string
            }[]
                           },
"party_player_stats":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"favorites": Json,"hero_stats": Json,"positions": (number)[],"rank_tier": number,"user_id": string
            }[]
                           },
"party_view":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"captain_asked_at": string,"captain_id": string,"captain_online": boolean,"captain_request_by": string,"captain_request_expires_at": string,"display_name": string,"joined_at": string,"leader_id": string,"party_id": string,"position": number,"server_now": string,"team_id": string,"user_id": string
            }[]
                           },
"played_draft":
{ Args: { "draft": string }; Returns: boolean
                           },
"profile_by_friend_code":
{ Args: { "code": string }; Returns: {
              "avatar_url": string,"display_name": string,"id": string
            }[]
                           },
"rank_bracket":
{ Args: { "p": Omit<Database["public"]['Tables']["profiles"]['Row'], Database["public"]['Tables']["profiles"]['ComputedFields']> }; Returns: number
                           },
"record_draft_players":
{ Args: { "draft": string,"joined_by"?: string }; Returns: undefined
                           },
"remove_from_party":
{ Args: { "target": string }; Returns: undefined
                           },
"report_draft_lists":
{ Args: { "draft": string }; Returns: {
              "hero_id": number,"shown": (number)[]
            }[]
                           },
"run_build_reports":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"run_refresh_trends":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"runs_team":
{ Args: { "team": string }; Returns: boolean
                           },
"save_draft_suggestions":
{ Args: { "chance"?: number,"draft": string,"pos": number,"shown": (number)[],"shown_scores": (number)[] }; Returns: undefined
                           },
"save_game_check_in":
{ Args: { "allies": (number)[],"ally_positions": (number)[],"bans": (number)[],"enemies": (number)[],"key": string,"my_hero": number,"my_position": number,"party_draft": string,"shown": (number)[],"story_shown": boolean }; Returns: string
                           },
"save_hero_fill":
{ Args: { "fill_positions": (number)[],"picks": Json,"player": string,"positioned_games": number,"result": string }; Returns: number
                           },
"save_matchup_guides":
{ Args: { "slices": Json,"version": number }; Returns: number
                           },
"save_trend_check":
{ Args: { "games": Json,"new_card": Json,"qualifying": (string)[],"state": string,"target": string }; Returns: undefined
                           },
"send_friend_request":
{ Args: { "target": string }; Returns: string
                           },
"set_check_in_result":
{ Args: { "check_in": string,"did_win": boolean,"match": number }; Returns: boolean
                           },
"set_favorite_hero":
{ Args: { "hero": number,"hero_position": number,"is_on": boolean }; Returns: Json
                           },
"set_game_started":
{ Args: { "check_in": string,"started": boolean }; Returns: string
                           },
"set_party_captain":
{ Args: { "party": string,"who": string }; Returns: undefined
                           },
"set_party_position":
{ Args: { "want": number }; Returns: undefined
                           },
"set_party_rank":
{ Args: { "bracket": number }; Returns: undefined
                           },
"set_pool_suggestions_off":
{ Args: { "is_off": boolean }; Returns: undefined
                           },
"set_share_heroes_with_friends":
{ Args: { "is_on": boolean }; Returns: undefined
                           },
"set_top_hero":
{ Args: { "hero": number,"hero_position": number,"is_top": boolean,"replace_hero"?: number }; Returns: Json
                           },
"skip_check_in":
{ Args: { "check_in": string }; Returns: undefined
                           },
"snooze_check_in":
{ Args: { "check_in": string }; Returns: undefined
                           },
"stack_games":
{ Args: { "teams": (string)[] }; Returns: {
              "games": number,"team_id": string
            }[]
                           },
"stack_members":
{ Args: { "team": string }; Returns: {
              "avatar_url": string,"display_name": string,"rank_tier": number,"role": string,"user_id": string
            }[]
                           },
"stack_page":
{ Args: { "team": string }; Returns: {
              "games": number,"id": string,"members": number,"my_request": string,"my_role": string,"name": string,"open_to_requests": boolean,"owner_name": string
            }[]
                           },
"stack_player_stats":
{ Args: { "team": string }; Returns: {
              "display_name": string,"favorites": Json,"hero_stats": Json,"positions": (number)[],"rank_tier": number,"user_id": string
            }[]
                           },
"stale_match_files":
{ Args: { "max_rows"?: number }; Returns: {
              "match_id": number
            }[]
                           },
"start_party":
{ Args: { "team"?: string }; Returns: string
                           },
"start_party_draft":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"step_down_captain":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"stop_support_copy":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"stratz_free_at":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"support_lists":
{ Args: { "player": string }; Returns: Json
                           },
"take_matchup_lookup":
{ Args: { "hourly_cap"?: number,"who": string }; Returns: boolean
                           },
"take_opendota_calls":
{ Args: { "caller_cap"?: number,"caller_name"?: string,"daily_cap"?: number,"wanted": number }; Returns: boolean
                           },
"take_stratz_calls":
{ Args: { "hourly_cap"?: number,"wanted": number }; Returns: boolean
                           },
"team_join_requests_for":
{ Args: { "team": string }; Returns: {
              "avatar_url": string,"created_at": string,"display_name": string,"rank_tier": number,"request_id": string,"user_id": string
            }[]
                           },
"top_heroes":
{ Args: { "hero_position": number,"player": string }; Returns: Json
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
