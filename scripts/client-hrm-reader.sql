-- A payroll client's own HRM → Aali One (Client payroll): a read-only login, the same as Aali HRM's (scripts/hrm-reader.sql)
-- plus each person's Employee ID, designation and department.
-- For a client whose HRM is a copy of Aali HRM that Aali set up for them, on its own Supabase project.
-- Run ONCE in THAT client's Supabase project: Supabase dashboard → SQL Editor → paste → Run. (For Jayanth.)
--
-- What it allows: Aali One may READ only the columns payroll needs –
--   who works there (id, email, name, active, designation, department, Employee ID, joining date, leaving date),
--   check-in / check-out times and office time, approved leaves, and holidays.
-- What it does NOT allow: any change at all, and no reading of bank details, PAN, Aadhaar, salaries, photos, faces, chat or locations.
--
-- 1. Replace CHOOSE-A-LONG-PASSWORD below with a long random password of letters and numbers only (no symbols, so it
--    can go into the connection string as it is). A different one for each client. Do not send it in chat or email.
-- 2. Run this whole script. If it shows an error, nothing was changed: send the error (never the password) to Nikhil.
-- 3. Supabase → "Connect" (top of the project) → "Transaction pooler" (port 6543). Copy it and change two things:
--      postgres.<project-ref>   →  aali_one_reader.<project-ref>   (keep the dot and the project ref)
--      [YOUR-PASSWORD]          →  the password you chose
-- 4. Aali One → Client payroll → the client → Details & rules: "Attendance comes from" = Their own HRM, with a short link
--    code, e.g. GSM. The page then names the hosting setting to add, e.g. HRM_DATABASE_URL_GSM.
-- 5. Vercel → project aali-one-test (the test site), and again in aali-one (live) → Settings → Environment Variables, Production:
--      HRM_DATABASE_URL_<link code> = the connection string from step 3
--    Then redeploy.
-- 6. Check: Aali One → Client payroll → the client → Their HRM shows each employee, found in their HRM or not.
--    Employees are matched by Employee ID: the employee code in Aali One must be the same as the Employee ID in their HRM.

create role aali_one_reader with login password 'CHOOSE-A-LONG-PASSWORD' nosuperuser nocreatedb nocreaterole noinherit;
grant usage on schema public to aali_one_reader;

-- Only these columns can be read.
grant select (id, email, full_name, is_active, joining_date, designation, department) on public.users to aali_one_reader;
grant select (user_id, employee_id, date_of_joining, exit_date) on public.employee_details to aali_one_reader;
grant select (user_id, date, check_in, check_out, working_hours, office_time) on public.attendance to aali_one_reader;
grant select (user_id, start_date, end_date, leave_type, status) on public.leave_requests to aali_one_reader;
grant select (date) on public.holidays to aali_one_reader;

-- The tables use row-level security, so the login also needs a "may read every row" rule on each of them.
create policy aali_one_reader_read on public.users for select to aali_one_reader using (true);
create policy aali_one_reader_read on public.employee_details for select to aali_one_reader using (true);
create policy aali_one_reader_read on public.attendance for select to aali_one_reader using (true);
create policy aali_one_reader_read on public.leave_requests for select to aali_one_reader using (true);
create policy aali_one_reader_read on public.holidays for select to aali_one_reader using (true);

-- Never allowed to run for long or to write.
alter role aali_one_reader set statement_timeout = '15s';
alter role aali_one_reader set default_transaction_read_only = on;

-- To switch the link off later:  drop owned by aali_one_reader; drop role aali_one_reader;
