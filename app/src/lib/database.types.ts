
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
            "assignments": {
                  Row: {
                    "assigned_at": string,"ended_at": string | null,"ended_by": string | null,"entry_id": string,"id": string,"org_id": string,"queue_id": string,"queue_position": number | null,"reason": string | null,"shift_id": string,"status": Database["public"]['Enums']["assignment_status"],"user_id": string
                  }
                  Insert: {
                    "assigned_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"entry_id": string,"id"?: string,"org_id": string,"queue_id": string,"queue_position"?: number | null,"reason"?: string | null,"shift_id": string,"status"?: Database["public"]['Enums']["assignment_status"],"user_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"entry_id"?: string,"id"?: string,"org_id"?: string,"queue_id"?: string,"queue_position"?: number | null,"reason"?: string | null,"shift_id"?: string,"status"?: Database["public"]['Enums']["assignment_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "assignments_ended_by_fkey"
      columns: ["ended_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "queue_entries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "assignments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"id": number,"org_id": string,"payload": NonNullable<Json>,"queue_id": string | null,"reason": string | null,"shift_id": string | null,"subject_id": string | null,"type": string
                  }
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"org_id": string,"payload"?: NonNullable<Json>,"queue_id"?: string | null,"reason"?: string | null,"shift_id"?: string | null,"subject_id"?: string | null,"type": string
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"id"?: never,"org_id"?: string,"payload"?: NonNullable<Json>,"queue_id"?: string | null,"reason"?: string | null,"shift_id"?: string | null,"subject_id"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_events_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"member_queue_prefs": {
                  Row: {
                    "auto_rejoin": boolean,"queue_id": string,"user_id": string
                  }
                  Insert: {
                    "auto_rejoin"?: boolean,"queue_id": string,"user_id": string
                  }
                  Update: {
                    "auto_rejoin"?: boolean,"queue_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "member_queue_prefs_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "member_queue_prefs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"deactivated_at": string | null,"org_id": string,"profession": Database["public"]['Enums']["profession"] | null,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["member_status"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"org_id": string,"profession"?: Database["public"]['Enums']["profession"] | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"org_id"?: string,"profession"?: Database["public"]['Enums']["profession"] | null,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_outbox": {
                  Row: {
                    "attempts": number,"channel": string,"created_at": string,"id": number,"is_fallback": boolean,"last_error": string | null,"next_attempt_at": string,"notification_id": string | null,"payload": NonNullable<Json>,"sent_at": string | null,"status": string,"template": string,"to_email": string | null,"user_id": string | null
                  }
                  Insert: {
                    "attempts"?: number,"channel": string,"created_at"?: string,"id"?: never,"is_fallback"?: boolean,"last_error"?: string | null,"next_attempt_at"?: string,"notification_id"?: string | null,"payload"?: NonNullable<Json>,"sent_at"?: string | null,"status"?: string,"template": string,"to_email"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"id"?: never,"is_fallback"?: boolean,"last_error"?: string | null,"next_attempt_at"?: string,"notification_id"?: string | null,"payload"?: NonNullable<Json>,"sent_at"?: string | null,"status"?: string,"template"?: string,"to_email"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_outbox_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_outbox_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_prefs": {
                  Row: {
                    "email": boolean,"push": boolean,"type": string,"user_id": string
                  }
                  Insert: {
                    "email"?: boolean,"push"?: boolean,"type": string,"user_id": string
                  }
                  Update: {
                    "email"?: boolean,"push"?: boolean,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_prefs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_tokens": {
                  Row: {
                    "created_at": string,"id": string,"last_seen_at": string,"platform": string,"token": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"last_seen_at"?: string,"platform": string,"token": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"last_seen_at"?: string,"platform"?: string,"token"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"dedupe_key": string | null,"id": string,"org_id": string | null,"payload": NonNullable<Json>,"read_at": string | null,"type": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"org_id"?: string | null,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"dedupe_key"?: string | null,"id"?: string,"org_id"?: string | null,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"join_code": string,"join_code_rotated_at": string | null,"name": string,"timezone": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"join_code"?: string,"join_code_rotated_at"?: string | null,"name": string,"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"join_code"?: string,"join_code_rotated_at"?: string | null,"name"?: string,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"display_name": string,"id": string,"locale": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id": string,"locale"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string,"id"?: string,"locale"?: string
                  }
                  Relationships: [
                    
                  ]
                },"queue_entries": {
                  Row: {
                    "close_reason": Database["public"]['Enums']["entry_close_reason"] | null,"closed_at": string | null,"closed_by": string | null,"held_assignment_id": string | null,"id": string,"joined_at": string,"org_id": string,"paused_at": string | null,"queue_id": string,"seq": number,"status": Database["public"]['Enums']["entry_status"],"top3_notified_at": string | null,"user_id": string
                  }
                  Insert: {
                    "close_reason"?: Database["public"]['Enums']["entry_close_reason"] | null,"closed_at"?: string | null,"closed_by"?: string | null,"held_assignment_id"?: string | null,"id"?: string,"joined_at": string,"org_id": string,"paused_at"?: string | null,"queue_id": string,"seq": number,"status"?: Database["public"]['Enums']["entry_status"],"top3_notified_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "close_reason"?: Database["public"]['Enums']["entry_close_reason"] | null,"closed_at"?: string | null,"closed_by"?: string | null,"held_assignment_id"?: string | null,"id"?: string,"joined_at"?: string,"org_id"?: string,"paused_at"?: string | null,"queue_id"?: string,"seq"?: number,"status"?: Database["public"]['Enums']["entry_status"],"top3_notified_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "queue_entries_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_entries_held_assignment_fk"
      columns: ["held_assignment_id"]
isOneToOne: false
      referencedRelation: "assignments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_entries_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"queues": {
                  Row: {
                    "archived_at": string | null,"created_at": string,"created_by": string | null,"description": string,"id": string,"name": string,"org_id": string,"profession": Database["public"]['Enums']["profession"] | null,"version": number
                  }
                  Insert: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"name": string,"org_id": string,"profession"?: Database["public"]['Enums']["profession"] | null,"version"?: number
                  }
                  Update: {
                    "archived_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string,"id"?: string,"name"?: string,"org_id"?: string,"profession"?: Database["public"]['Enums']["profession"] | null,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "queues_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queues_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"shifts": {
                  Row: {
                    "batch_id": string | null,"cancelled_reason": string | null,"created_at": string,"created_by": string | null,"ended_at": string | null,"ends_at": string,"id": string,"notes": string,"org_id": string,"published_at": string | null,"queue_id": string,"slots": number,"start_processed_at": string | null,"starts_at": string,"status": Database["public"]['Enums']["shift_status"],"unit": string
                  }
                  Insert: {
                    "batch_id"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"ended_at"?: string | null,"ends_at": string,"id"?: string,"notes"?: string,"org_id": string,"published_at"?: string | null,"queue_id": string,"slots"?: number,"start_processed_at"?: string | null,"starts_at": string,"status"?: Database["public"]['Enums']["shift_status"],"unit"?: string
                  }
                  Update: {
                    "batch_id"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"ended_at"?: string | null,"ends_at"?: string,"id"?: string,"notes"?: string,"org_id"?: string,"published_at"?: string | null,"queue_id"?: string,"slots"?: number,"start_processed_at"?: string | null,"starts_at"?: string,"status"?: Database["public"]['Enums']["shift_status"],"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shifts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shifts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shifts_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_audit":
{ Args: { "p_before_id"?: number,"p_from"?: string,"p_limit"?: number,"p_org": string,"p_queue"?: string,"p_subject"?: string,"p_to"?: string,"p_types"?: (string)[] }; Returns: {
              "actor_id": string,"actor_name": string,"created_at": string,"id": number,"payload": Json,"queue_id": string,"queue_profession": Database["public"]['Enums']["profession"],"reason": string,"shift_id": string,"subject_id": string,"subject_name": string,"type": string
            }[]
                           },
"admin_hospital_code":
{ Args: { "p_org": string }; Returns: {
              "join_code": string,"rotated_at": string
            }[]
                           },
"admin_professionals":
{ Args: { "p_org": string }; Returns: {
              "display_name": string,"email": string,"entry_joined_at": string,"member_since": string,"profession": Database["public"]['Enums']["profession"],"queue_id": string,"queue_position": number,"queue_state": string,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["member_status"],"user_id": string
            }[]
                           },
"admin_queue_overview":
{ Args: { "p_org": string }; Returns: {
              "assigned": number,"open_shifts": number,"open_slots": number,"paused": number,"profession": Database["public"]['Enums']["profession"],"queue_id": string,"waiting": number
            }[]
                           },
"admin_remove_entry":
{ Args: { "p_queue": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"admin_shifts":
{ Args: { "p_from"?: string,"p_org": string,"p_profession"?: Database["public"]['Enums']["profession"],"p_scope"?: string,"p_shift"?: string,"p_to"?: string }; Returns: {
              "assignees": Json,"cancelled_reason": string,"ends_at": string,"filled": number,"notes": string,"profession": Database["public"]['Enums']["profession"],"published_at": string,"queue_id": string,"shift_id": string,"slots": number,"starts_at": string,"status": Database["public"]['Enums']["shift_status"],"unit": string
            }[]
                           },
"cancel_shift":
{ Args: { "p_reason"?: string,"p_shift": string }; Returns: undefined
                           },
"claim_notification_outbox":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,"channel": string,"id": number,"is_fallback": boolean,"locale": string,"notification_id": string,"payload": Json,"push_already_sent": boolean,"push_tokens": (string)[],"template": string,"to_email": string,"user_email": string,"user_id": string
            }[]
                           },
"complete_notification_outbox":
{ Args: { "p_error"?: string,"p_id": number,"p_invalid_tokens"?: (string)[],"p_status": string }; Returns: undefined
                           },
"complete_shift":
{ Args: { "p_shift": string }; Returns: undefined
                           },
"create_shifts":
{ Args: { "p_org": string,"p_profession": Database["public"]['Enums']["profession"],"p_publish"?: boolean,"p_shifts": Json }; Returns: string[]
                           },
"deactivate_member":
{ Args: { "p_org": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"delete_draft_shift":
{ Args: { "p_shift": string }; Returns: undefined
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"export_audit_csv":
{ Args: { "p_from"?: string,"p_org": string,"p_queue"?: string,"p_subject"?: string,"p_to"?: string,"p_types"?: (string)[] }; Returns: string
                           },
"export_my_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"fairness_report":
{ Args: { "p_from": string,"p_org": string,"p_profession"?: Database["public"]['Enums']["profession"],"p_to": string }; Returns: {
              "avg_wait_hours": number,"display_name": string,"given_back": number,"in_queue": boolean,"no_shows": number,"profession": Database["public"]['Enums']["profession"],"shifts_assigned": number,"shifts_completed": number,"user_id": string
            }[]
                           },
"give_back_shift":
{ Args: { "p_reason"?: string,"p_shift": string }; Returns: undefined
                           },
"hook_before_user_created":
{ Args: { "event": Json }; Returns: Json
                           },
"join_hospital":
{ Args: { "p_code": string,"p_profession": Database["public"]['Enums']["profession"] }; Returns: string
                           },
"join_queue":
{ Args: { "p_queue": string }; Returns: string
                           },
"leave_queue":
{ Args: { "p_queue": string }; Returns: undefined
                           },
"mark_no_show":
{ Args: { "p_assignment": string,"p_reason"?: string }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: { "p_ids"?: (string)[] }; Returns: undefined
                           },
"my_queue":
{ Args: { "p_org"?: string }; Returns: {
              "auto_rejoin": boolean,"joined_at": string,"org_id": string,"org_timezone": string,"profession": Database["public"]['Enums']["profession"],"queue_id": string,"queue_position": number,"queue_total": number,"shift_ends_at": string,"shift_id": string,"shift_notes": string,"shift_starts_at": string,"shift_unit": string,"state": string
            }[]
                           },
"my_shifts":
{ Args: { "p_org"?: string,"p_scope"?: string }; Returns: {
              "assigned_at": string,"assignment_id": string,"assignment_status": Database["public"]['Enums']["assignment_status"],"ends_at": string,"notes": string,"org_id": string,"org_timezone": string,"profession": Database["public"]['Enums']["profession"],"queue_id": string,"queue_position": number,"shift_id": string,"shift_status": Database["public"]['Enums']["shift_status"],"slots": number,"starts_at": string,"unit": string
            }[]
                           },
"pause_queue":
{ Args: { "p_queue": string }; Returns: undefined
                           },
"publish_shifts":
{ Args: { "p_shift_ids": (string)[] }; Returns: undefined
                           },
"queue_roster":
{ Args: { "p_queue": string }; Returns: {
              "assigned_shift_id": string,"assigned_shift_starts_at": string,"display_name": string,"joined_at": string,"paused_at": string,"queue_position": number,"state": string,"user_id": string
            }[]
                           },
"queue_stats":
{ Args: { "p_from": string,"p_org": string,"p_to": string }; Returns: {
              "avg_time_to_fill_minutes": number,"avg_wait_hours": number,"paused": number,"profession": Database["public"]['Enums']["profession"],"queue_id": string,"queue_size": number,"shifts_published": number,"slots_filled": number,"slots_published": number
            }[]
                           },
"reactivate_member":
{ Args: { "p_org": string,"p_user": string }; Returns: undefined
                           },
"regenerate_join_code":
{ Args: { "p_org": string }; Returns: string
                           },
"register_push_token":
{ Args: { "p_platform": string,"p_token": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "p_org": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"resume_queue":
{ Args: { "p_queue": string }; Returns: undefined
                           },
"server_time":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"set_member_profession":
{ Args: { "p_org": string,"p_profession": Database["public"]['Enums']["profession"],"p_reason"?: string,"p_user": string }; Returns: undefined
                           },
"set_member_role":
{ Args: { "p_org": string,"p_role": Database["public"]['Enums']["member_role"],"p_user": string }; Returns: undefined
                           },
"set_queue_auto_rejoin":
{ Args: { "p_enabled": boolean,"p_queue": string }; Returns: undefined
                           },
"unregister_push_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"update_organization":
{ Args: { "p_name"?: string,"p_org": string,"p_timezone"?: string }; Returns: undefined
                           },
"update_shift":
{ Args: { "p_patch": Json,"p_shift": string }; Returns: undefined
                           }
          }
          Enums: {
            "assignment_status": "active"|"completed"|"no_show"|"cancelled"|"withdrawn","entry_close_reason": "completed"|"no_show"|"withdrew"|"left"|"removed"|"moved_to_end"|"deactivated"|"account_deleted"|"eligibility_revoked"|"queue_archived"|"profession_changed","entry_status": "waiting"|"paused"|"held","member_role": "owner"|"admin"|"staff","member_status": "active"|"deactivated","profession": "doctor"|"nurse","shift_status": "draft"|"open"|"filled"|"completed"|"cancelled"
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
            "assignment_status": ["active", "completed", "no_show", "cancelled", "withdrawn"],"entry_close_reason": ["completed", "no_show", "withdrew", "left", "removed", "moved_to_end", "deactivated", "account_deleted", "eligibility_revoked", "queue_archived", "profession_changed"],"entry_status": ["waiting", "paused", "held"],"member_role": ["owner", "admin", "staff"],"member_status": ["active", "deactivated"],"profession": ["doctor", "nurse"],"shift_status": ["draft", "open", "filled", "completed", "cancelled"]
          }
        }
} as const
