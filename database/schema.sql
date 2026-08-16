-- ============================================================
-- DeadLineHero - Oracle SQL Schema
-- ============================================================
--
-- Catatan: Aplikasi runtime pakai PostgreSQL (driver `pg`).
-- Skrip ini ditulis dalam dialek Oracle SQL untuk submission akademik.
-- Untuk DB live PostgreSQL, jalankan ekuivalen berikut secara manual:
--
--   ALTER TABLE users ADD COLUMN selected_ringtone VARCHAR(100);
--   ALTER TABLE users ALTER COLUMN selected_ringtone SET DEFAULT '/sounds/ringtone1.mp3';
--
-- Nilai yang diizinkan: '/sounds/ringtone1.mp3', '/sounds/ringtone2.mp3', '/sounds/ringtone3.mp3'.

-- Drop sequence & tables (urut dependency)
DROP TABLE task_completions  CASCADE CONSTRAINTS;
DROP TABLE notification_log   CASCADE CONSTRAINTS;
DROP TABLE user_task_status CASCADE CONSTRAINTS;
DROP TABLE tasks CASCADE CONSTRAINTS;
DROP TABLE users CASCADE CONSTRAINTS;
DROP SEQUENCE seq_users;
DROP SEQUENCE seq_tasks;
DROP SEQUENCE seq_user_task_status;

-- ============================================================
-- Table: USERS
-- ============================================================
CREATE TABLE users (
    id_user          NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    npm              VARCHAR2(20)  NOT NULL,
    nama             VARCHAR2(100) NOT NULL,
    email            VARCHAR2(100) NOT NULL UNIQUE,
    password_plain   VARCHAR2(255) NOT NULL,
    role             VARCHAR2(20)  DEFAULT 'user' NOT NULL,
    no_wa            VARCHAR2(20),
    preferensi       VARCHAR2(30)  DEFAULT 'nada_dering' NOT NULL,
    relasi           VARCHAR2(20),
    selected_ringtone VARCHAR2(100) DEFAULT '/sounds/ringtone1.mp3',
    CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin')),
    CONSTRAINT chk_users_preferensi CHECK (preferensi IN ('nomor_wa', 'nada_dering')),
    CONSTRAINT chk_users_relasi CHECK (relasi IS NULL OR relasi IN ('pacar', 'keluarga', 'sahabat')),
    CONSTRAINT chk_users_ringtone CHECK (
        selected_ringtone IS NULL
        OR selected_ringtone IN ('/sounds/ringtone1.mp3', '/sounds/ringtone2.mp3', '/sounds/ringtone3.mp3')
    )
);

-- ============================================================
-- Table: TASKS
-- ============================================================
CREATE TABLE tasks (
    id_tugas    NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    judul       VARCHAR2(200) NOT NULL,
    deskripsi   CLOB,
    kategori    VARCHAR2(20)  NOT NULL,
    sumber_web  VARCHAR2(30),
    deadline    TIMESTAMP     NOT NULL,
    created_by  NUMBER        NOT NULL,
    created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_archived NUMBER(1)     DEFAULT 0 NOT NULL,
    archived_at TIMESTAMP,
    CONSTRAINT fk_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id_user),
    CONSTRAINT chk_tasks_kategori CHECK (kategori IN ('Tugas', 'UTS', 'UAS')),
    CONSTRAINT chk_tasks_sumber   CHECK (sumber_web IN ('Vclass', 'Ilab', 'Praktikum')),
    CONSTRAINT chk_tasks_archived CHECK (is_archived IN (0, 1))
);

-- ============================================================
-- Table: USER_TASK_STATUS
-- ============================================================
CREATE TABLE user_task_status (
    id_status   NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    id_user     NUMBER NOT NULL,
    id_tugas    NUMBER NOT NULL,
    status      VARCHAR2(20) DEFAULT 'belum' NOT NULL,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_uts_user  FOREIGN KEY (id_user)  REFERENCES users(id_user),
    CONSTRAINT fk_uts_task  FOREIGN KEY (id_tugas) REFERENCES tasks(id_tugas),
    CONSTRAINT uk_uts_user_task UNIQUE (id_user, id_tugas),
    CONSTRAINT chk_uts_status CHECK (status IN ('belum', 'selesai'))
);

CREATE INDEX idx_tasks_deadline      ON tasks(deadline);
CREATE INDEX idx_tasks_kategori      ON tasks(kategori);
CREATE INDEX idx_uts_id_user         ON user_task_status(id_user);
CREATE INDEX idx_uts_id_tugas        ON user_task_status(id_tugas);

-- Migrasi DB eksisting: tambah kolom relasi jika belum ada
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE users ADD (relasi VARCHAR2(20))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE users ADD CONSTRAINT chk_users_relasi CHECK (relasi IS NULL OR relasi IN (''pacar'', ''keluarga'', ''sahabat''))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2264 THEN RAISE; END IF;
END;
/

-- Migrasi: tambah kolom selected_ringtone jika belum ada
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE users ADD (selected_ringtone VARCHAR2(100) DEFAULT ''/sounds/ringtone1.mp3'')';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE users ADD CONSTRAINT chk_users_ringtone CHECK (selected_ringtone IS NULL OR selected_ringtone IN (''/sounds/ringtone1.mp3'', ''/sounds/ringtone2.mp3'', ''/sounds/ringtone3.mp3''))';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -2264 THEN RAISE; END IF;
END;
/

-- ============================================================
-- Table: TASK_COMPLETIONS (riwayat klik "Mark As Done" untuk rekap/arsip)
-- ============================================================
CREATE TABLE task_completions (
    id_completion NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    id_tugas      NUMBER NOT NULL,
    id_user       NUMBER NOT NULL,
    completed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_tc_task FOREIGN KEY (id_tugas) REFERENCES tasks(id_tugas),
    CONSTRAINT fk_tc_user FOREIGN KEY (id_user) REFERENCES users(id_user),
    CONSTRAINT uk_tc_task_user UNIQUE (id_tugas, id_user)
);

CREATE INDEX idx_tc_id_user ON task_completions(id_user);

-- Migrasi DB eksisting (Oracle): tambah kolom arsip jika belum ada
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE tasks ADD (created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_archived NUMBER(1) DEFAULT 0, archived_at TIMESTAMP)';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/

-- Ekuivalen PostgreSQL live (dijalankan otomatis oleh ensureRecapSchema() saat server start):
--   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
--   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
--   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
--   CREATE TABLE IF NOT EXISTS task_completions (
--       id_completion BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--       id_tugas      BIGINT NOT NULL REFERENCES tasks(id_tugas) ON DELETE CASCADE,
--       id_user       BIGINT NOT NULL REFERENCES users(id_user) ON DELETE CASCADE,
--       completed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
--       CONSTRAINT uk_task_completions UNIQUE (id_tugas, id_user)
--   );

-- ============================================================
-- Table: NOTIFICATION_LOG (anti-spam notifikasi terkirim)
-- ============================================================
CREATE TABLE notification_log (
    id_notif    NUMBER GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1) PRIMARY KEY,
    id_user     NUMBER NOT NULL,
    id_tugas    NUMBER NOT NULL,
    jenis       VARCHAR2(20) NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_nl_user  FOREIGN KEY (id_user)  REFERENCES users(id_user),
    CONSTRAINT fk_nl_task  FOREIGN KEY (id_tugas) REFERENCES tasks(id_tugas),
    CONSTRAINT uk_nl_user_task_jenis UNIQUE (id_user, id_tugas, jenis),
    CONSTRAINT chk_nl_jenis CHECK (jenis IN ('wa_h1jam', 'ring_h1jam', 'pwa_h1hari'))
);

CREATE INDEX idx_nl_jenis ON notification_log(jenis);

-- ============================================================
-- DML: 15 Admin Statis (AdminPAslab1 - AdminPAslab15)
-- Password plain: admin123
-- ============================================================
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN001', 'AdminPAslab1',  'adminpaslab1@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN002', 'AdminPAslab2',  'adminpaslab2@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN003', 'AdminPAslab3',  'adminpaslab3@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN004', 'AdminPAslab4',  'adminpaslab4@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN005', 'AdminPAslab5',  'adminpaslab5@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN006', 'AdminPAslab6',  'adminpaslab6@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN007', 'AdminPAslab7',  'adminpaslab7@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN008', 'AdminPAslab8',  'adminpaslab8@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN009', 'AdminPAslab9',  'adminpaslab9@deadlinehero.local',  'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN010', 'AdminPAslab10', 'adminpaslab10@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN011', 'AdminPAslab11', 'adminpaslab11@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN012', 'AdminPAslab12', 'adminpaslab12@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN013', 'AdminPAslab13', 'adminpaslab13@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN014', 'AdminPAslab14', 'adminpaslab14@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');
INSERT INTO users (npm, nama, email, password_plain, role, no_wa, preferensi) VALUES ('ADMIN015', 'AdminPAslab15', 'adminpaslab15@deadlinehero.local', 'admin123', 'admin', NULL, 'nada_dering');

COMMIT;
