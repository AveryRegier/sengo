# Sengo Shell

This package provides an interactive shell for the Sengo MongoDB-like client.

## AWS S3 Setup for Sengo

To use the S3 backend, you must have the AWS CLI installed and configured, and an S3 bucket created for your database.

### 1. Install the AWS CLI

Follow the instructions for your OS:  
https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

### 2. Configure the AWS CLI

Run:

```
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, default region (e.g., `us-east-1`), and output format (`json`).

### 3. Create an S3 Bucket

Choose a unique bucket name (e.g., `sengo-db`):

```
aws s3api create-bucket --bucket sengo-db --region us-east-1
```

### 4. Using the Sengo Shell with S3

Start the shell:

```
npm start
```

Connect to the S3 backend (optionally specify region):

```
sengo> connect sengo-db
```

Use a collection (e.g., `test`):

```
sengo> use test
```

Insert a document:

```
sengo> insertOne {"name": "Bob", "age": 7}
```

You should see output like:

```
{
  "acknowledged": true,
  "insertedId": "..."
}
```

Retrieve documents:

```
sengo> find {}
```

Example output:

```
[
  {
    "name": "Bob",
    "age": 7,
    "_id": "..."
  }
]
```

---

For more details, see the main README or the client package documentation.
