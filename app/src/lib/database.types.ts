
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
                    "assigned_at": string,"ended_at": string | null,"ended_by": string | null,"entry_id": string,"id": string,"offer_id": string,"org_id": string,"queue_id": string,"reason": string | null,"shift_id": string,"status": Database["public"]['Enums']["assignment_status"],"user_id": string
                  }
                  Insert: {
                    "assigned_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"entry_id": string,"id"?: string,"offer_id": string,"org_id": string,"queue_id": string,"reason"?: string | null,"shift_id": string,"status"?: Database["public"]['Enums']["assignment_status"],"user_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"entry_id"?: string,"id"?: string,"offer_id"?: string,"org_id"?: string,"queue_id"?: string,"reason"?: string | null,"shift_id"?: string,"status"?: Database["public"]['Enums']["assignment_status"],"user_id"?: string
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
      foreignKeyName: "assignments_offer_id_fkey"
      columns: ["offer_id"]
isOneToOne: false
      referencedRelation: "offers"
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
                },"invites": {
                  Row: {
                    "code": string | null,"created_at": string,"created_by": string | null,"email": string | null,"expires_at": string,"id": string,"kind": Database["public"]['Enums']["invite_kind"],"max_uses": number,"org_id": string,"queue_ids": (string)[],"revoked_at": string | null,"role": Database["public"]['Enums']["member_role"],"token_hash": string | null,"use_count": number
                  }
                  Insert: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"expires_at": string,"id"?: string,"kind": Database["public"]['Enums']["invite_kind"],"max_uses"?: number,"org_id": string,"queue_ids"?: (string)[],"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"token_hash"?: string | null,"use_count"?: number
                  }
                  Update: {
                    "code"?: string | null,"created_at"?: string,"created_by"?: string | null,"email"?: string | null,"expires_at"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["invite_kind"],"max_uses"?: number,"org_id"?: string,"queue_ids"?: (string)[],"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"token_hash"?: string | null,"use_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"member_queue_prefs": {
                  Row: {
                    "auto_rejoin": boolean,"cooldown_until": string | null,"queue_id": string,"rejoin_requires_approval": boolean,"user_id": string
                  }
                  Insert: {
                    "auto_rejoin"?: boolean,"cooldown_until"?: string | null,"queue_id": string,"rejoin_requires_approval"?: boolean,"user_id": string
                  }
                  Update: {
                    "auto_rejoin"?: boolean,"cooldown_until"?: string | null,"queue_id"?: string,"rejoin_requires_approval"?: boolean,"user_id"?: string
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
                    "created_at": string,"deactivated_at": string | null,"org_id": string,"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["member_status"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"deactivated_at"?: string | null,"org_id": string,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"deactivated_at"?: string | null,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"status"?: Database["public"]['Enums']["member_status"],"user_id"?: string
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
                },"offers": {
                  Row: {
                    "entry_id": string,"expires_at": string,"id": string,"offered_at": string,"org_id": string,"outcome": Database["public"]['Enums']["offer_outcome"] | null,"outcome_reason": string | null,"queue_id": string,"queue_position": number | null,"reminder_sent_at": string | null,"responded_at": string | null,"round": number,"shift_id": string,"user_id": string
                  }
                  Insert: {
                    "entry_id": string,"expires_at": string,"id"?: string,"offered_at"?: string,"org_id": string,"outcome"?: Database["public"]['Enums']["offer_outcome"] | null,"outcome_reason"?: string | null,"queue_id": string,"queue_position"?: number | null,"reminder_sent_at"?: string | null,"responded_at"?: string | null,"round": number,"shift_id": string,"user_id": string
                  }
                  Update: {
                    "entry_id"?: string,"expires_at"?: string,"id"?: string,"offered_at"?: string,"org_id"?: string,"outcome"?: Database["public"]['Enums']["offer_outcome"] | null,"outcome_reason"?: string | null,"queue_id"?: string,"queue_position"?: number | null,"reminder_sent_at"?: string | null,"responded_at"?: string | null,"round"?: number,"shift_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "offers_entry_id_fkey"
      columns: ["entry_id"]
isOneToOne: false
      referencedRelation: "queue_entries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "offers_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"staff_can_see_names": boolean,"timezone": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"staff_can_see_names"?: boolean,"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"staff_can_see_names"?: boolean,"timezone"?: string
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
                    "close_reason": Database["public"]['Enums']["entry_close_reason"] | null,"closed_at": string | null,"closed_by": string | null,"consecutive_timeouts": number,"held_assignment_id": string | null,"id": string,"joined_at": string,"org_id": string,"paused_at": string | null,"queue_id": string,"seq": number,"status": Database["public"]['Enums']["entry_status"],"top3_notified_at": string | null,"user_id": string
                  }
                  Insert: {
                    "close_reason"?: Database["public"]['Enums']["entry_close_reason"] | null,"closed_at"?: string | null,"closed_by"?: string | null,"consecutive_timeouts"?: number,"held_assignment_id"?: string | null,"id"?: string,"joined_at": string,"org_id": string,"paused_at"?: string | null,"queue_id": string,"seq": number,"status"?: Database["public"]['Enums']["entry_status"],"top3_notified_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "close_reason"?: Database["public"]['Enums']["entry_close_reason"] | null,"closed_at"?: string | null,"closed_by"?: string | null,"consecutive_timeouts"?: number,"held_assignment_id"?: string | null,"id"?: string,"joined_at"?: string,"org_id"?: string,"paused_at"?: string | null,"queue_id"?: string,"seq"?: number,"status"?: Database["public"]['Enums']["entry_status"],"top3_notified_at"?: string | null,"user_id"?: string
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
                },"queue_members": {
                  Row: {
                    "added_at": string,"added_by": string | null,"org_id": string,"queue_id": string,"user_id": string
                  }
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"org_id": string,"queue_id": string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"org_id"?: string,"queue_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "queue_members_added_by_fkey"
      columns: ["added_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_members_queue_id_fkey"
      columns: ["queue_id"]
isOneToOne: false
      referencedRelation: "queues"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queue_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"queues": {
                  Row: {
                    "acceptance_window": string,"archived_at": string | null,"auto_pause_after_timeouts": number | null,"created_at": string,"created_by": string | null,"decline_policy": Database["public"]['Enums']["position_policy"],"description": string,"id": string,"lottery_drawn_at": string | null,"lottery_ends_at": string | null,"name": string,"no_show_cooldown": string,"no_show_policy": Database["public"]['Enums']["no_show_policy"],"org_id": string,"pausing_allowed": boolean,"reoffer_after_withdraw": Database["public"]['Enums']["reoffer_policy"],"timeout_policy": Database["public"]['Enums']["position_policy"],"version": number,"withdraw_cooldown": string
                  }
                  Insert: {
                    "acceptance_window"?: string,"archived_at"?: string | null,"auto_pause_after_timeouts"?: number | null,"created_at"?: string,"created_by"?: string | null,"decline_policy"?: Database["public"]['Enums']["position_policy"],"description"?: string,"id"?: string,"lottery_drawn_at"?: string | null,"lottery_ends_at"?: string | null,"name": string,"no_show_cooldown"?: string,"no_show_policy"?: Database["public"]['Enums']["no_show_policy"],"org_id": string,"pausing_allowed"?: boolean,"reoffer_after_withdraw"?: Database["public"]['Enums']["reoffer_policy"],"timeout_policy"?: Database["public"]['Enums']["position_policy"],"version"?: number,"withdraw_cooldown"?: string
                  }
                  Update: {
                    "acceptance_window"?: string,"archived_at"?: string | null,"auto_pause_after_timeouts"?: number | null,"created_at"?: string,"created_by"?: string | null,"decline_policy"?: Database["public"]['Enums']["position_policy"],"description"?: string,"id"?: string,"lottery_drawn_at"?: string | null,"lottery_ends_at"?: string | null,"name"?: string,"no_show_cooldown"?: string,"no_show_policy"?: Database["public"]['Enums']["no_show_policy"],"org_id"?: string,"pausing_allowed"?: boolean,"reoffer_after_withdraw"?: Database["public"]['Enums']["reoffer_policy"],"timeout_policy"?: Database["public"]['Enums']["position_policy"],"version"?: number,"withdraw_cooldown"?: string
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
                    "batch_id": string | null,"cancelled_reason": string | null,"created_at": string,"created_by": string | null,"ended_at": string | null,"ends_at": string,"id": string,"notes": string,"offer_round": number,"org_id": string,"published_at": string | null,"queue_id": string,"starts_at": string,"status": Database["public"]['Enums']["shift_status"],"unfilled_notified_at": string | null,"unit": string
                  }
                  Insert: {
                    "batch_id"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"ended_at"?: string | null,"ends_at": string,"id"?: string,"notes"?: string,"offer_round"?: number,"org_id": string,"published_at"?: string | null,"queue_id": string,"starts_at": string,"status"?: Database["public"]['Enums']["shift_status"],"unfilled_notified_at"?: string | null,"unit"?: string
                  }
                  Update: {
                    "batch_id"?: string | null,"cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"ended_at"?: string | null,"ends_at"?: string,"id"?: string,"notes"?: string,"offer_round"?: number,"org_id"?: string,"published_at"?: string | null,"queue_id"?: string,"starts_at"?: string,"status"?: Database["public"]['Enums']["shift_status"],"unfilled_notified_at"?: string | null,"unit"?: string
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
            "accept_invite":
{ Args: { "p_token": string }; Returns: string
                           },
"accept_offer":
{ Args: { "p_offer": string }; Returns: string
                           },
"add_queue_members":
{ Args: { "p_queue": string,"p_user_ids": (string)[] }; Returns: number
                           },
"admin_audit":
{ Args: { "p_before_id"?: number,"p_from"?: string,"p_limit"?: number,"p_org": string,"p_queue"?: string,"p_subject"?: string,"p_to"?: string,"p_types"?: (string)[] }; Returns: {
              "actor_id": string,"actor_name": string,"created_at": string,"id": number,"payload": Json,"queue_id": string,"queue_name": string,"reason": string,"shift_id": string,"subject_id": string,"subject_name": string,"type": string
            }[]
                           },
"admin_members":
{ Args: { "p_org": string }; Returns: {
              "display_name": string,"email": string,"joined_at": string,"queue_ids": (string)[],"role": Database["public"]['Enums']["member_role"],"status": Database["public"]['Enums']["member_status"],"user_id": string
            }[]
                           },
"admin_remove_entry":
{ Args: { "p_queue": string,"p_reason": string,"p_revoke_eligibility"?: boolean,"p_user": string }; Returns: undefined
                           },
"admin_shifts":
{ Args: { "p_from"?: string,"p_org": string,"p_queue"?: string,"p_to"?: string }; Returns: {
              "assignee_id": string,"assignee_name": string,"current_offer_expires_at": string,"current_offer_name": string,"current_offer_position": number,"current_offer_user": string,"declined_count": number,"ends_at": string,"expired_count": number,"notes": string,"offer_round": number,"published_at": string,"queue_id": string,"queue_name": string,"shift_id": string,"starts_at": string,"status": Database["public"]['Enums']["shift_status"],"unit": string
            }[]
                           },
"allow_rejoin":
{ Args: { "p_queue": string,"p_reason"?: string,"p_user": string }; Returns: undefined
                           },
"archive_queue":
{ Args: { "p_queue": string,"p_reason": string }; Returns: undefined
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
"create_invite":
{ Args: { "p_email"?: string,"p_expires_in"?: string,"p_kind": Database["public"]['Enums']["invite_kind"],"p_max_uses"?: number,"p_org": string,"p_queue_ids"?: (string)[],"p_role"?: Database["public"]['Enums']["member_role"] }; Returns: {
              "invite_id": string,"token": string
            }[]
                           },
"create_organization":
{ Args: { "p_name": string,"p_timezone": string }; Returns: string
                           },
"create_queue":
{ Args: { "p_description"?: string,"p_name": string,"p_org": string,"p_policy"?: Json }; Returns: string
                           },
"create_shifts":
{ Args: { "p_publish"?: boolean,"p_queue": string,"p_shifts": Json }; Returns: string[]
                           },
"deactivate_member":
{ Args: { "p_org": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"decline_offer":
{ Args: { "p_offer": string }; Returns: undefined
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
{ Args: { "p_from": string,"p_org": string,"p_queue"?: string,"p_to": string }; Returns: {
              "avg_wait_hours": number,"display_name": string,"in_queue": boolean,"no_shows": number,"offers_declined": number,"offers_expired": number,"shifts_assigned": number,"shifts_completed": number,"user_id": string,"withdrawals": number
            }[]
                           },
"get_invite_preview":
{ Args: { "p_token": string }; Returns: {
              "org_name": string,"reason": string,"role": Database["public"]['Enums']["member_role"],"valid": boolean
            }[]
                           },
"get_offer":
{ Args: { "p_offer": string }; Returns: {
              "decline_policy": Database["public"]['Enums']["position_policy"],"ends_at": string,"expires_at": string,"notes": string,"offer_id": string,"offered_at": string,"org_id": string,"org_name": string,"org_timezone": string,"outcome": Database["public"]['Enums']["offer_outcome"],"queue_id": string,"queue_name": string,"server_now": string,"shift_id": string,"starts_at": string,"unit": string
            }[]
                           },
"join_queue":
{ Args: { "p_queue": string }; Returns: string
                           },
"leave_queue":
{ Args: { "p_queue": string }; Returns: undefined
                           },
"mark_no_show":
{ Args: { "p_reason"?: string,"p_shift": string }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: { "p_ids"?: (string)[] }; Returns: undefined
                           },
"my_queues":
{ Args: { "p_org"?: string }; Returns: {
              "assigned_shift_id": string,"auto_rejoin": boolean,"cooldown_until": string,"description": string,"filled_30d": number,"joined_at": string,"lottery_ends_at": string,"lottery_pending": boolean,"needs_approval": boolean,"offer_expires_at": string,"offer_id": string,"org_id": string,"pausing_allowed": boolean,"queue_id": string,"queue_name": string,"queue_position": number,"queue_total": number,"state": string
            }[]
                           },
"my_shifts":
{ Args: { "p_org"?: string,"p_scope"?: string }; Returns: {
              "assigned_at": string,"assignment_id": string,"assignment_status": Database["public"]['Enums']["assignment_status"],"ends_at": string,"notes": string,"org_id": string,"org_timezone": string,"queue_id": string,"queue_name": string,"shift_id": string,"shift_status": Database["public"]['Enums']["shift_status"],"starts_at": string,"unit": string
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
              "assigned_shift_id": string,"display_name": string,"is_me": boolean,"joined_at": string,"offer_expires_at": string,"paused_at": string,"queue_position": number,"state": string,"user_id": string
            }[]
                           },
"queue_stats":
{ Args: { "p_from": string,"p_org": string,"p_to": string }; Returns: {
              "avg_time_to_fill_minutes": number,"avg_wait_hours": number,"paused": number,"queue_id": string,"queue_name": string,"queue_size": number,"shifts_filled": number,"shifts_published": number,"shifts_unfilled": number
            }[]
                           },
"reactivate_member":
{ Args: { "p_org": string,"p_user": string }; Returns: undefined
                           },
"register_push_token":
{ Args: { "p_platform": string,"p_token": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "p_org": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"remove_queue_member":
{ Args: { "p_queue": string,"p_reason": string,"p_user": string }; Returns: undefined
                           },
"reoffer_shift":
{ Args: { "p_shift": string }; Returns: undefined
                           },
"resume_queue":
{ Args: { "p_queue": string }; Returns: undefined
                           },
"revoke_invite":
{ Args: { "p_invite": string }; Returns: undefined
                           },
"server_time":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"set_member_role":
{ Args: { "p_org": string,"p_role": Database["public"]['Enums']["member_role"],"p_user": string }; Returns: undefined
                           },
"set_queue_auto_rejoin":
{ Args: { "p_enabled": boolean,"p_queue": string }; Returns: undefined
                           },
"shift_offer_history":
{ Args: { "p_shift": string }; Returns: {
              "display_name": string,"expires_at": string,"offer_id": string,"offered_at": string,"outcome": Database["public"]['Enums']["offer_outcome"],"outcome_reason": string,"queue_position": number,"responded_at": string,"round": number,"user_id": string
            }[]
                           },
"unregister_push_token":
{ Args: { "p_token": string }; Returns: undefined
                           },
"update_organization":
{ Args: { "p_name"?: string,"p_org": string,"p_staff_can_see_names"?: boolean,"p_timezone"?: string }; Returns: undefined
                           },
"update_queue":
{ Args: { "p_description"?: string,"p_name"?: string,"p_policy"?: Json,"p_queue": string }; Returns: undefined
                           },
"update_shift":
{ Args: { "p_patch": Json,"p_shift": string }; Returns: undefined
                           },
"withdraw_assignment":
{ Args: { "p_reason"?: string,"p_shift": string }; Returns: undefined
                           }
          }
          Enums: {
            "assignment_status": "active"|"completed"|"no_show"|"cancelled"|"withdrawn","entry_close_reason": "completed"|"no_show"|"withdrew"|"left"|"removed"|"moved_to_end"|"deactivated"|"account_deleted"|"eligibility_revoked"|"queue_archived","entry_status": "waiting"|"paused"|"held","invite_kind": "email"|"code","member_role": "owner"|"admin"|"staff","member_status": "active"|"deactivated","no_show_policy": "rejoin_end"|"cooldown"|"admin_approval","offer_outcome": "accepted"|"declined"|"expired"|"revoked","position_policy": "keep"|"move_to_end","reoffer_policy": "restart"|"continue","shift_status": "draft"|"published"|"offered"|"assigned"|"completed"|"no_show"|"cancelled"|"unfilled"
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
            "assignment_status": ["active", "completed", "no_show", "cancelled", "withdrawn"],"entry_close_reason": ["completed", "no_show", "withdrew", "left", "removed", "moved_to_end", "deactivated", "account_deleted", "eligibility_revoked", "queue_archived"],"entry_status": ["waiting", "paused", "held"],"invite_kind": ["email", "code"],"member_role": ["owner", "admin", "staff"],"member_status": ["active", "deactivated"],"no_show_policy": ["rejoin_end", "cooldown", "admin_approval"],"offer_outcome": ["accepted", "declined", "expired", "revoked"],"position_policy": ["keep", "move_to_end"],"reoffer_policy": ["restart", "continue"],"shift_status": ["draft", "published", "offered", "assigned", "completed", "no_show", "cancelled", "unfilled"]
          }
        }
} as const
