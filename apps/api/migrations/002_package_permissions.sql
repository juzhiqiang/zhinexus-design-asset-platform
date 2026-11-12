-- Package ownership is independent from component ownership, including core-only dependency packages.
CREATE TABLE package_permissions (
  subject text NOT NULL,
  package_name text NOT NULL,
  PRIMARY KEY(subject, package_name)
);
