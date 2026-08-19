create table public.notification_log (
  id_user integer null,
  id_tugas integer null,
  jenis character varying(100) null,
  notified_at timestamp without time zone null default CURRENT_TIMESTAMP,
  id_notif serial not null,
  constraint notification_log_pkey primary key (id_notif),
  constraint notification_log_id_tugas_fkey foreign KEY (id_tugas) references tasks (id_tugas),
  constraint notification_log_id_user_fkey foreign KEY (id_user) references users (id_user),
  constraint chk_nl_jenis check (
    (
      (jenis)::text = any (
        (
          array[
            'wa_h1jam'::character varying,
            'ring_h1jam'::character varying,
            'pwa_h1hari'::character varying,
            'H-1_RELASI'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create table public.task_completions (
  id_completion bigint generated always as identity not null,
  id_tugas bigint not null,
  id_user bigint not null,
  completed_at timestamp without time zone not null default now(),
  constraint task_completions_pkey primary key (id_completion),
  constraint uk_task_completions unique (id_tugas, id_user),
  constraint task_completions_id_tugas_fkey foreign KEY (id_tugas) references tasks (id_tugas) on delete CASCADE,
  constraint task_completions_id_user_fkey foreign KEY (id_user) references users (id_user) on delete CASCADE
) TABLESPACE pg_default;

create table public.tasks (
  id_tugas serial not null,
  judul character varying(255) not null,
  deskripsi text null,
  deadline timestamp without time zone not null,
  kategori character varying(100) null,
  created_by integer null,
  created_at timestamp without time zone null default CURRENT_TIMESTAMP,
  sumber_web character varying(255) null,
  is_archived boolean not null default false,
  archived_at timestamp without time zone null,
  constraint tasks_pkey primary key (id_tugas),
  constraint tasks_created_by_fkey foreign KEY (created_by) references users (id_user)
) TABLESPACE pg_default;

create table public.user_task_status (
  id_status serial not null,
  id_user integer null,
  id_tugas integer null,
  is_completed boolean null default false,
  completed_at timestamp without time zone null,
  status character varying(50) null,
  updated_at timestamp without time zone null default CURRENT_TIMESTAMP,
  constraint user_task_status_pkey primary key (id_status),
  constraint user_task_status_unique unique (id_user, id_tugas),
  constraint user_task_status_id_tugas_fkey foreign KEY (id_tugas) references tasks (id_tugas) on delete CASCADE,
  constraint user_task_status_id_user_fkey foreign KEY (id_user) references users (id_user) on delete CASCADE
) TABLESPACE pg_default;

create table public.users (
  id_user serial not null,
  npm character varying(50) null,
  nama character varying(255) null,
  email character varying(255) not null,
  password character varying(255) not null,
  role character varying(50) null,
  preferensi character varying(100) null,
  no_wa character varying(50) null,
  relasi character varying(50) null,
  created_at timestamp without time zone null default CURRENT_TIMESTAMP,
  selected_ringtone character varying(100) null default '/sounds/ringtone1.mp3'::character varying,
  constraint users_pkey primary key (id_user),
  constraint users_email_key unique (email),
  constraint users_npm_format check (((npm)::text ~ '^[0-9]{8,10}$'::text)),
  constraint users_role_check check (
    (
      (role)::text = any (
        (
          array[
            'user'::character varying,
            'admin'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;